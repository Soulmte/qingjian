use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::services;
use crate::state::AppState;

/// Key used in the `secret` table. Deliberately not part of `setting`: that
/// table is returned wholesale to the frontend by `load_settings`.
pub const TOKEN_KEY: &str = "gitToken";

/// Where the image hosting lives. GitHub first; Gitee's API is close enough that
/// only the URL, the auth placement and the raw address differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitProvider {
    Github,
    Gitee,
}

impl GitProvider {
    fn contents_url(self, repo: &str, path: &str) -> String {
        match self {
            GitProvider::Github => {
                format!("https://api.github.com/repos/{repo}/contents/{}", encode_path(path))
            }
            GitProvider::Gitee => format!(
                "https://gitee.com/api/v5/repos/{repo}/contents/{}",
                encode_path(path)
            ),
        }
    }

    /// The address a Markdown document should reference.
    pub fn raw_url(self, repo: &str, branch: &str, path: &str) -> String {
        match self {
            GitProvider::Github => format!(
                "https://raw.githubusercontent.com/{repo}/{branch}/{}",
                encode_path(path)
            ),
            GitProvider::Gitee => {
                format!("https://gitee.com/{repo}/raw/{branch}/{}", encode_path(path))
            }
        }
    }

    /// Gitee takes the token in the body; GitHub wants a bearer header.
    fn uses_bearer_auth(self) -> bool {
        matches!(self, GitProvider::Github)
    }

    /// Name shown to the user, so messages do not have to re-derive it.
    pub fn label(self) -> &'static str {
        match self {
            GitProvider::Github => "GitHub",
            GitProvider::Gitee => "Gitee",
        }
    }

    /// Endpoint that reports one branch, used to prove a configuration works
    /// before the first image depends on it.
    fn branch_url(self, repo: &str, branch: &str) -> String {
        match self {
            GitProvider::Github => format!(
                "https://api.github.com/repos/{repo}/branches/{}",
                encode_path(branch)
            ),
            GitProvider::Gitee => format!(
                "https://gitee.com/api/v5/repos/{repo}/branches/{}",
                encode_path(branch)
            ),
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Validation (pure, so it can be tested without a network)                    */
/* -------------------------------------------------------------------------- */

/// Checks `owner/name`.
///
/// The repository name is pasted straight into a request URL, so anything that
/// could steer the request elsewhere — extra separators, traversal, spaces — is
/// rejected here rather than sent to the provider.
pub fn validate_repo(repo: &str) -> AppResult<()> {
    let mut parts = repo.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    let extra = parts.next();

    if extra.is_some() {
        return Err(AppError::Message(
            "仓库格式应为 owner/repo，例如 octocat/notes".into(),
        ));
    }
    if !is_safe_segment(owner) || !is_safe_segment(name) {
        return Err(AppError::Message(
            "仓库名只能包含字母、数字、点、下划线和连字符".into(),
        ));
    }
    Ok(())
}

/// Branches may contain slashes, but must not escape or contain spaces.
pub fn validate_branch(branch: &str) -> AppResult<()> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("分支不能为空".into()));
    }
    if trimmed.contains("..")
        || trimmed.starts_with('/')
        || trimmed.ends_with('/')
        || trimmed.chars().any(|c| c.is_whitespace() || c == '\\' || c == '?' || c == '#')
    {
        return Err(AppError::Message(format!("分支名不合法：{branch}")));
    }
    Ok(())
}

fn is_safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Percent-encodes everything outside the unreserved set, keeping `/`.
///
/// Image paths are user-visible and often contain spaces or Chinese, and the
/// provider expects a URL-safe path.
fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '/') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Builds the JSON body each provider expects.
///
/// `sha` is present only when the path already exists: both APIs treat it as the
/// signal to replace an existing blob rather than create a new one, and reject a
/// create that would overwrite.
pub fn request_body(
    provider: GitProvider,
    token: &str,
    content_base64: &str,
    branch: &str,
    message: &str,
    sha: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "message": message,
        "content": content_base64,
        "branch": branch,
    });
    if let Some(sha) = sha {
        body["sha"] = serde_json::Value::String(sha.to_string());
    }
    if !provider.uses_bearer_auth() {
        body["access_token"] = serde_json::Value::String(token.to_string());
    }
    body
}

/// Query string for a lookup on one path: the branch to read from, plus the
/// token on providers that put it in the query instead of a header.
pub fn contents_query(provider: GitProvider, branch: &str, token: &str) -> String {
    let mut query = format!("ref={}", encode_path(branch));
    if !provider.uses_bearer_auth() {
        query.push_str(&format!("&access_token={}", encode_path(token)));
    }
    format!("?{query}")
}

/// Query string carrying just the token, for endpoints that need no `ref`.
pub fn token_query(provider: GitProvider, token: &str) -> String {
    if provider.uses_bearer_auth() {
        String::new()
    } else {
        format!("?access_token={}", encode_path(token))
    }
}

/// Reads the blob SHA out of a contents response, so an upload can become an
/// update instead of a create.
///
/// Providers report a missing path as a 404 rather than an empty object, so
/// `None` here means "nothing at that path".
pub fn parse_sha(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value
        .get("sha")
        .and_then(|sha| sha.as_str())
        .map(str::to_string)
        .filter(|sha| !sha.is_empty())
}

/* -------------------------------------------------------------------------- */
/* Secret storage                                                             */
/* -------------------------------------------------------------------------- */

pub async fn read_token(pool: &SqlitePool) -> AppResult<Option<String>> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM secret WHERE key = ?")
            .bind(TOKEN_KEY)
            .fetch_optional(pool)
            .await?;
    Ok(value.filter(|token| !token.trim().is_empty()))
}

pub async fn write_token(pool: &SqlitePool, token: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO secret (key, value, updated_at) VALUES (?, ?, unixepoch()) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()",
    )
    .bind(TOKEN_KEY)
    .bind(token)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_token(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM secret WHERE key = ?")
        .bind(TOKEN_KEY)
        .execute(pool)
        .await?;
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */

/// An agent configured to report HTTP errors as values, so a failure body can be
/// read: "Bad credentials" is the whole reason a user can fix the problem.
fn build_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(45)))
        .user_agent("qingjian")
        .build()
        .new_agent()
}

/// Adds the bearer header GitHub expects. Gitee's token travels in the query or
/// body instead, so its requests are left untouched.
fn authorize_get(
    provider: GitProvider,
    token: &str,
    request: ureq::RequestBuilder<ureq::typestate::WithoutBody>,
) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    if provider.uses_bearer_auth() {
        request
            .header("Authorization", &format!("Bearer {token}"))
            .header("X-GitHub-Api-Version", "2022-11-28")
    } else {
        request
    }
}

/// Looks up the SHA of an existing file, or `None` when the path is free.
fn existing_sha(
    agent: &ureq::Agent,
    provider: GitProvider,
    token: &str,
    repo: &str,
    branch: &str,
    path: &str,
) -> Option<String> {
    let url = format!(
        "{}{}",
        provider.contents_url(repo, path),
        contents_query(provider, branch, token)
    );
    let request =
        authorize_get(provider, token, agent.get(&url)).header("Accept", "application/json");

    let response = request.call().ok()?;
    if response.status().as_u16() != 200 {
        return None;
    }
    let body = response.into_body().read_to_string().ok()?;
    parse_sha(&body)
}

/// Uploads one image and returns the URL to reference it by.
///
/// The token is read here, in Rust, and never crosses the IPC boundary — the
/// webview additionally runs with no CSP, so a token in the frontend would be
/// reachable from any script in the page.
#[allow(clippy::too_many_arguments)]
pub fn upload_impl(
    provider: GitProvider,
    token: &str,
    repo: &str,
    branch: &str,
    dir: &str,
    file_name: &str,
    data: &[u8],
) -> AppResult<String> {
    validate_repo(repo)?;
    validate_branch(branch)?;

    let dir = services::normalize_relative_dir(dir);
    let file_name = services::sanitize_file_name(file_name);
    let path = if dir.is_empty() {
        // Cloned rather than moved: the name is still needed for the commit
        // message below, and a conditional move would end its life here.
        file_name.clone()
    } else {
        format!("{dir}/{file_name}")
    };

    let agent = build_agent();
    let url = provider.contents_url(repo, &path);

    // Reusing a name has to replace the blob: a create over an existing path is
    // rejected by both providers, and "图上同名就传不上去" is not a useful rule.
    let existing = existing_sha(&agent, provider, token, repo, branch, &path);

    let encoded = STANDARD.encode(data);
    let body = request_body(
        provider,
        token,
        &encoded,
        branch,
        &format!("docs: add image {file_name}"),
        existing.as_deref(),
    );

    // GitHub creates and updates with PUT; Gitee splits them into POST (create)
    // and PUT (update). `Agent` exposes the verbs as separate methods rather than
    // one taking a verb, so the choice is made here.
    let request = match (provider, existing.is_some()) {
        (GitProvider::Github, _) | (GitProvider::Gitee, true) => agent.put(&url),
        (GitProvider::Gitee, false) => agent.post(&url),
    }
    .header("Accept", "application/json");

    let request = if provider.uses_bearer_auth() {
        request
            .header("Authorization", &format!("Bearer {token}"))
            .header("X-GitHub-Api-Version", "2022-11-28")
    } else {
        request
    };

    let response = request
        .send_json(&body)
        .map_err(|error| AppError::Message(format!("无法连接图床：{error}")))?;

    let status = response.status().as_u16();
    let text = response
        .into_body()
        .read_to_string()
        .unwrap_or_else(|_| String::new());

    if !(200..300).contains(&status) {
        return Err(AppError::Message(format!(
            "图床上传失败（HTTP {status}）：{}",
            summarize(&text)
        )));
    }

    Ok(provider.raw_url(repo, branch, &path))
}

/// Verifies the repository and branch are reachable with the stored token.
///
/// A dry run turns "the first image silently failed" into a readable reason:
/// authentication, a misspelled repository and a missing branch each report
/// differently.
pub fn verify_impl(
    provider: GitProvider,
    token: &str,
    repo: &str,
    branch: &str,
) -> AppResult<String> {
    validate_repo(repo)?;
    validate_branch(branch)?;

    let agent = build_agent();
    let url = format!(
        "{}{}",
        provider.branch_url(repo, branch),
        token_query(provider, token)
    );
    let request =
        authorize_get(provider, token, agent.get(&url)).header("Accept", "application/json");

    let response = request
        .call()
        .map_err(|error| AppError::Message(format!("无法连接 {}：{error}", provider.label())))?;

    let status = response.status().as_u16();
    let text = response
        .into_body()
        .read_to_string()
        .unwrap_or_else(|_| String::new());

    match status {
        200 => Ok(format!(
            "连接成功：{} · {repo} · {branch}",
            provider.label()
        )),
        401 => Err(AppError::Message("认证失败：Token 无效或已过期".into())),
        403 => Err(AppError::Message("权限不足：请确认 Token 具备仓库读写权限".into())),
        404 => Err(AppError::Message(format!(
            "找不到仓库或分支：{repo} / {branch}"
        ))),
        _ => Err(AppError::Message(format!(
            "校验失败（HTTP {status}）：{}",
            summarize(&text)
        ))),
    }
}

/// Truncates a provider error so a giant HTML page cannot fill the UI.
fn summarize(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "没有返回内容".into();
    }
    trimmed.chars().take(300).collect()
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub async fn set_git_token(state: State<'_, AppState>, token: String) -> AppResult<()> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("Token 不能为空".into()));
    }
    write_token(&state.pool, trimmed).await
}

#[tauri::command]
pub async fn clear_git_token(state: State<'_, AppState>) -> AppResult<()> {
    clear_token(&state.pool).await
}

/// Whether a token is stored. The token itself is never returned.
#[tauri::command]
pub async fn git_token_configured(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(read_token(&state.pool).await?.is_some())
}

#[tauri::command]
pub async fn upload_image_to_git(
    state: State<'_, AppState>,
    provider: GitProvider,
    repo: String,
    branch: String,
    dir: String,
    file_name: String,
    data: Vec<u8>,
) -> AppResult<String> {
    if data.is_empty() {
        return Err(AppError::Message("图片内容为空".into()));
    }

    let token = read_token(&state.pool)
        .await?
        .ok_or_else(|| AppError::Message("还没有配置图床 Token（设置 → 图像）".into()))?;

    // ureq is blocking; keeping it off the async runtime's worker threads avoids
    // stalling every other command while the upload runs.
    tauri::async_runtime::spawn_blocking(move || {
        upload_impl(
            provider,
            &token,
            &repo,
            &branch,
            &dir,
            &file_name,
            &data,
        )
    })
    .await
    .map_err(|error| AppError::Message(format!("上传任务失败：{error}")))?
}

/// Checks the configured repository and branch, so a mistake is caught in the
/// settings dialog rather than on the first image.
#[tauri::command]
pub async fn test_git_connection(
    state: State<'_, AppState>,
    provider: GitProvider,
    repo: String,
    branch: String,
) -> AppResult<String> {
    let token = read_token(&state.pool)
        .await?
        .ok_or_else(|| AppError::Message("还没有配置图床 Token（设置 → 图像）".into()))?;

    tauri::async_runtime::spawn_blocking(move || verify_impl(provider, &token, &repo, &branch))
        .await
        .map_err(|error| AppError::Message(format!("校验任务失败：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_owner_repo() {
        assert!(validate_repo("octocat/notes").is_ok());
        assert!(validate_repo("my.org/my_repo-2").is_ok());
    }

    #[test]
    fn rejects_repo_values_that_could_steer_the_request() {
        for bad in [
            "",
            "notes",
            "owner/",
            "/name",
            "owner/name/extra",
            "owner/../etc",
            "owner/na me",
            "owner/na%2fme",
            "https://evil.test/x",
        ] {
            assert!(validate_repo(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn branch_allows_slashes_but_not_traversal() {
        assert!(validate_branch("main").is_ok());
        assert!(validate_branch("release/2024").is_ok());
        for bad in ["", "   ", "..", "a/../b", "/lead", "trail/", "has space", "a\\b"] {
            assert!(validate_branch(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn raw_urls_match_each_provider_convention() {
        assert_eq!(
            GitProvider::Github.raw_url("me/notes", "main", "assets/a.png"),
            "https://raw.githubusercontent.com/me/notes/main/assets/a.png"
        );
        assert_eq!(
            GitProvider::Gitee.raw_url("me/notes", "main", "assets/a.png"),
            "https://gitee.com/me/notes/raw/main/assets/a.png"
        );
    }

    #[test]
    fn paths_with_spaces_and_chinese_are_encoded() {
        assert_eq!(encode_path("assets/贴图 1.png"), "assets/%E8%B4%B4%E5%9B%BE%201.png");
        assert_eq!(
            GitProvider::Github.contents_url("me/notes", "assets/贴图.png"),
            "https://api.github.com/repos/me/notes/contents/assets/%E8%B4%B4%E5%9B%BE.png"
        );
    }

    #[test]
    fn gitee_puts_the_token_in_the_body_and_github_does_not() {
        let github = request_body(GitProvider::Github, "tok", "QUJD", "main", "msg", None);
        assert!(github.get("access_token").is_none());
        assert_eq!(github["content"], "QUJD");
        assert_eq!(github["branch"], "main");
        assert!(github.get("sha").is_none());

        let gitee = request_body(GitProvider::Gitee, "tok", "QUJD", "main", "msg", None);
        assert_eq!(gitee["access_token"], "tok");
    }

    #[test]
    fn an_existing_blob_adds_its_sha_so_the_upload_becomes_an_update() {
        let body = request_body(GitProvider::Github, "tok", "QUJD", "main", "msg", Some("abc123"));
        assert_eq!(body["sha"], "abc123");
        assert!(body.get("access_token").is_none());
    }

    #[test]
    fn sha_is_read_out_of_a_contents_response() {
        assert_eq!(parse_sha(r#"{"sha":"abc123","path":"a.png"}"#), Some("abc123".into()));
        assert_eq!(parse_sha(r#"{"sha":""}"#), None);
        assert_eq!(parse_sha(r#"{"message":"Not Found"}"#), None);
        assert_eq!(parse_sha("not json"), None);
    }

    #[test]
    fn queries_carry_the_branch_and_only_gitee_carries_the_token() {
        assert_eq!(contents_query(GitProvider::Github, "main", "tok"), "?ref=main");
        assert_eq!(
            contents_query(GitProvider::Gitee, "main", "tok"),
            "?ref=main&access_token=tok"
        );
        assert_eq!(token_query(GitProvider::Github, "tok"), "");
        assert_eq!(token_query(GitProvider::Gitee, "tok"), "?access_token=tok");
    }

    #[test]
    fn branch_endpoints_follow_each_provider() {
        assert_eq!(
            GitProvider::Github.branch_url("me/notes", "release/1"),
            "https://api.github.com/repos/me/notes/branches/release/1"
        );
        assert_eq!(
            GitProvider::Gitee.branch_url("me/notes", "main"),
            "https://gitee.com/api/v5/repos/me/notes/branches/main"
        );
    }

    #[test]
    fn error_bodies_are_truncated() {
        assert_eq!(summarize("  "), "没有返回内容");
        assert_eq!(summarize("Bad credentials"), "Bad credentials");
        assert_eq!(summarize(&"x".repeat(500)).chars().count(), 300);
    }
}
