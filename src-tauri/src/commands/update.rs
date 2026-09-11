//! 检查 GitHub Releases 上有没有新版本。
//!
//! 这里只做「查」与「取」，不做「装」：真正原地替换二进制需要
//! `tauri-plugin-updater` 和一对签名密钥，也要在 release 里附一份
//! `latest.json`。那套东西在这个离线环境里拉不下来，所以本模块的职责是
//! 把版本信息、更新说明和安装包地址取回来交给界面，由用户一键下载后自己安装。
//!
//! 请求用匿名方式发：GitHub 对匿名请求限每小时 60 次，够用；复用图床那枚
//! token 反而会把「图床配错了」的问题带到更新检查上来。

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::services;

const API_ROOT: &str = "https://api.github.com/repos";

/// GitHub 的 release 载荷，只留下界面要用的字段。
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// 交给前端的检查结果。字段名转成 camelCase，与其它模型一致。
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub prerelease: bool,
    /// Release 标题；没写标题时退回 tag。
    pub title: Option<String>,
    /// 更新说明（Markdown 原文）。
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub release_url: Option<String>,
    /// 当前平台的安装包，能从 assets 里认出来时才有。
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
}

/* -------------------------------------------------------------------------- */
/* 版本比较                                                                    */
/* -------------------------------------------------------------------------- */

/// 从 tag 里切出版本号。
///
/// tag 的写法五花八门：`v1.2.3`、`app-v1.2.3`、`tauri-v2.11.5`。
/// 后者正是 `tauri-apps/tauri-action` 默认打的形状，所以「从第一个数字开始
/// 切」比「去掉开头的 v」可靠得多——前缀会把版本号整个吃掉。
fn version_from_tag(tag: &str) -> &str {
    let trimmed = tag.trim();
    match trimmed.find(|ch: char| ch.is_ascii_digit()) {
        Some(index) => trimmed[index..].trim(),
        None => trimmed,
    }
}

/// 宽松地把版本号拆成数字段与预发布标记。
///
/// 不用 semver crate：GitHub 上的 tag 什么写法都有，而 semver 对拿不准的输入
/// 直接判非法，宁可就地宽容一点。
fn parse_version(raw: &str) -> (Vec<u64>, Option<String>) {
    let version = version_from_tag(raw);
    let (numbers, prerelease) = match version.split_once('-') {
        Some((head, tail)) => (head, Some(tail)),
        None => (version, None),
    };

    let numbers = numbers
        .split('.')
        .map(|part| {
            // `1.2.3+build` 这类构建元数据不参与比较，遇到就截断
            let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
            digits.parse::<u64>().unwrap_or(0)
        })
        .collect();

    let prerelease = prerelease
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    (numbers, prerelease)
}

/// `candidate` 是否比 `current` 新。
///
/// 数字段逐位比较（短的一方补 0），数字相同时**正式版比预发布版新**——
/// 这正是 `1.0.0` 与 `1.0.0-rc.1` 应该有的关系。
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let (left, left_pre) = parse_version(candidate);
    let (right, right_pre) = parse_version(current);

    let width = left.len().max(right.len());
    for index in 0..width {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }

    match (left_pre, right_pre) {
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (Some(a), Some(b)) => a > b,
        (None, None) => false,
    }
}

/* -------------------------------------------------------------------------- */
/* 安装包挑选                                                                  */
/* -------------------------------------------------------------------------- */

/// 当前平台安装包的后缀。`.sig` 是签名文件，`latest.json` 是给自动更新用的
/// 清单，两者都不是给人装的。
fn platform_suffixes() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &[".exe", ".msi"]
    } else if cfg!(target_os = "macos") {
        &[".dmg"]
    } else {
        &[".appimage", ".deb", ".rpm"]
    }
}

/// 从 assets 里挑出当前平台的安装包。挑不中也不影响「有新版本」这个结论。
fn pick_asset(assets: &[Asset]) -> Option<&Asset> {
    let suffixes = platform_suffixes();
    assets.iter().find(|asset| {
        let lower = asset.name.to_ascii_lowercase();
        !lower.ends_with(".sig") && suffixes.iter().any(|suffix| lower.ends_with(suffix))
    })
}

/* -------------------------------------------------------------------------- */
/* 解析                                                                        */
/* -------------------------------------------------------------------------- */

/// 把 release 的 JSON 正文整理成 `UpdateInfo`。抽出来是为了能脱离网络测试。
pub fn summarize(payload: &str, current_version: &str) -> AppResult<UpdateInfo> {
    let release: Release = serde_json::from_str(payload)
        .map_err(|error| AppError::Message(format!("无法解析 GitHub 的返回：{error}")))?;

    let latest = version_from_tag(&release.tag_name).to_string();
    let asset = pick_asset(&release.assets);

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        update_available: is_newer(&latest, current_version),
        latest_version: latest,
        prerelease: release.prerelease,
        title: release
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| Some(release.tag_name.clone())),
        notes: release.body.filter(|value| !value.trim().is_empty()),
        published_at: release.published_at,
        release_url: release.html_url,
        asset_name: asset.map(|item| item.name.clone()),
        asset_url: asset.map(|item| item.browser_download_url.clone()),
    })
}

/* -------------------------------------------------------------------------- */
/* 网络                                                                        */
/* -------------------------------------------------------------------------- */

fn build_agent(timeout_secs: u64) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(timeout_secs)))
        .user_agent("qingjian")
        .build()
        .new_agent()
}

/// 校验 `owner/repo`。与图床那边同样的形状，所以同样的规则。
pub fn validate_repository(repository: &str) -> AppResult<()> {
    let trimmed = repository.trim();
    let mut parts = trimmed.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();

    if parts.next().is_some()
        || owner.is_empty()
        || name.is_empty()
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '_' | '.'))
    {
        return Err(AppError::Message(format!(
            "仓库格式应为 owner/repo，例如 octocat/qingjian：{repository}"
        )));
    }
    Ok(())
}

fn check_impl(current_version: &str, repository: &str, include_prerelease: bool) -> AppResult<UpdateInfo> {
    validate_repository(repository)?;

    // 要预发布版就取列表的第一条，GitHub 按发布时间倒序返回。
    let url = if include_prerelease {
        format!("{API_ROOT}/{repository}/releases?per_page=1")
    } else {
        format!("{API_ROOT}/{repository}/releases/latest")
    };

    let response = build_agent(20)
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(|error| AppError::Message(format!("无法连接 GitHub：{error}")))?;

    let status = response.status().as_u16();
    let body = response
        .into_body()
        .read_to_string()
        .map_err(|error| AppError::Message(format!("读取 GitHub 的返回失败：{error}")))?;

    match status {
        200 => {}
        404 => {
            return Err(AppError::Message(format!(
                "找不到仓库或它还没有发布过 Release：{repository}"
            )))
        }
        403 => {
            return Err(AppError::Message(
                "GitHub 拒绝了这次请求（多半是匿名调用达到每小时 60 次的上限），稍后再试。"
                    .into(),
            ))
        }
        other => {
            return Err(AppError::Message(format!(
                "GitHub 返回了 {other}：{}",
                body.chars().take(200).collect::<String>()
            )))
        }
    }

    if include_prerelease {
        // `/releases` 返回数组，取第一条再走同一套解析
        let list: Vec<serde_json::Value> = serde_json::from_str(&body)
            .map_err(|error| AppError::Message(format!("无法解析 GitHub 的返回：{error}")))?;
        let first = list
            .into_iter()
            .next()
            .ok_or_else(|| AppError::Message(format!("该仓库还没有发布过 Release：{repository}")))?;
        return summarize(&first.to_string(), current_version);
    }

    summarize(&body, current_version)
}

/* -------------------------------------------------------------------------- */
/* 命令                                                                        */
/* -------------------------------------------------------------------------- */

/// 查一次最新版本。`currentVersion` 由前端传入，用的是界面上显示的那个版本，
/// 两边不会各说各话。
#[tauri::command]
pub async fn check_for_updates(
    repository: String,
    current_version: String,
    include_prerelease: bool,
) -> AppResult<UpdateInfo> {
    // ureq 是阻塞的，扔到阻塞池里，别占住异步运行时的工作线程。
    tauri::async_runtime::spawn_blocking(move || {
        check_impl(&current_version, &repository, include_prerelease)
    })
    .await
    .map_err(|error| AppError::Message(format!("检查更新失败：{error}")))?
}

/// 只认 GitHub 的发布地址。地址虽然来自接口返回，但白名单能挡住「前端被喂了
/// 一个任意 URL」这种情况——下载下来的东西是会被用户双击运行的。
fn download_url_is_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/")
}

/// 允许在外部浏览器里打开的站点。范围收得比下载宽一点（还有 Gitee），
/// 但仍然是白名单，而不是一个通用的跳转口子。
fn external_url_is_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("https://gitee.com/")
}

fn download_impl(app: &AppHandle, url: &str, file_name: &str) -> AppResult<String> {
    if !download_url_is_allowed(url) {
        return Err(AppError::Message(format!("不接受这个下载地址：{url}")));
    }

    let file_name = services::sanitize_file_name(file_name);
    if file_name.is_empty() {
        return Err(AppError::Message("安装包文件名不合法".into()));
    }

    let dir = app
        .path()
        .download_dir()
        .map_err(|error| AppError::Message(format!("找不到下载目录：{error}")))?;

    // 不覆盖同名文件：重名就往后编号。
    let mut target = dir.join(&file_name);
    let mut counter = 1;
    while target.exists() {
        let stem = file_name.rsplit_once('.').map(|(head, _)| head).unwrap_or(&file_name);
        let extension = file_name.rsplit_once('.').map(|(_, tail)| tail).unwrap_or("");
        let next = if extension.is_empty() {
            format!("{stem} ({counter})")
        } else {
            format!("{stem} ({counter}).{extension}")
        };
        target = dir.join(next);
        counter += 1;
    }

    let response = build_agent(600)
        .get(url)
        .call()
        .map_err(|error| AppError::Message(format!("下载失败：{error}")))?;

    let status = response.status().as_u16();
    if status != 200 {
        return Err(AppError::Message(format!("下载失败，GitHub 返回 {status}")));
    }

    let mut reader = response.into_body().into_reader();
    let mut file = std::fs::File::create(&target)?;
    std::io::copy(&mut reader, &mut file)?;

    Ok(target.to_string_lossy().into_owned())
}

/// 把安装包下到系统下载目录，返回落地路径，交给界面去「在文件夹中显示」。
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    file_name: String,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || download_impl(&app, &url, &file_name))
        .await
        .map_err(|error| AppError::Message(format!("下载任务失败：{error}")))?
}

/// 在系统默认浏览器里打开一个链接。项目自己的主页、发布页、下载页都走这里。
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    if !external_url_is_allowed(&url) {
        return Err(AppError::Message(format!("不接受这个地址：{url}")));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Message(format!("无法打开链接：{error}")))
}

/// 在文件管理器里定位一个刚下好的文件。
#[tauri::command]
pub async fn reveal_downloaded(app: AppHandle, path: String) -> AppResult<()> {
    let file = std::path::PathBuf::from(&path);
    if !file.exists() {
        return Err(AppError::Message(format!("文件不存在：{path}")));
    }
    app.opener()
        .reveal_item_in_dir(&file)
        .map_err(|error| AppError::Message(format!("无法定位文件：{error}")))
}

/* -------------------------------------------------------------------------- */
/* 测试                                                                        */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_numerically_not_lexically() {
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(is_newer("v1.2.3", "1.2.2"));
        assert!(is_newer("2.0", "1.9.9"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("1.2.2", "1.2.3"));
    }

    #[test]
    fn a_release_beats_its_own_prerelease() {
        assert!(is_newer("1.0.0", "1.0.0-rc.1"));
        assert!(!is_newer("1.0.0-rc.1", "1.0.0"));
        assert!(is_newer("1.0.0-beta", "1.0.0-alpha"));
    }

    #[test]
    fn missing_segments_count_as_zero() {
        assert!(!is_newer("1.2", "1.2.0"));
        assert!(is_newer("1.2.1", "1.2"));
    }

    #[test]
    fn tags_with_a_project_prefix_are_understood() {
        // tauri-action 默认打的 tag 是 app-v0.2.0，前缀不能把版本号吃掉
        assert!(is_newer("app-v0.2.0", "0.1.9"));
        assert!(!is_newer("app-v0.1.0", "0.1.0"));
        assert_eq!(version_from_tag("tauri-v2.11.5"), "2.11.5");
        assert_eq!(version_from_tag("release-1.2.3-beta.1"), "1.2.3-beta.1");
        assert_eq!(version_from_tag(" v0.2.0 "), "0.2.0");
        assert!(is_newer("release-1.2.3", "1.2.3-beta.1"));
    }

    #[test]
    fn the_release_json_is_summarized() {
        // 要用 r###"…"### ：说明里必然出现 "## （JSON 引号 + Markdown 标题），
        // 它正好是 r##"…"## 的终止符，会把字符串提前截断。
        let payload = r###"{
            "tag_name": "v0.2.0",
            "name": "青简 0.2.0",
            "body": "## 新内容\n- 更新检查",
            "html_url": "https://github.com/lq/qingjian/releases/tag/v0.2.0",
            "published_at": "2026-09-11T10:00:00Z",
            "prerelease": false,
            "assets": [
                {"name": "Setup.exe.sig", "browser_download_url": "https://github.com/lq/qingjian/S.sig"},
                {"name": "青简_0.2.0_x64-setup.exe", "browser_download_url": "https://github.com/lq/qingjian/Setup.exe"}
            ]
        }"###;

        let info = summarize(payload, "0.1.0").expect("应当解析成功");
        assert_eq!(info.latest_version, "0.2.0");
        assert!(info.update_available);
        assert_eq!(info.title.as_deref(), Some("青简 0.2.0"));
        assert!(info.notes.as_deref().unwrap().contains("更新检查"));
        // .sig 必须被跳过，否则用户下到的是签名而不是安装包
        assert_eq!(info.asset_name.as_deref(), Some("青简_0.2.0_x64-setup.exe"));
        assert!(info.asset_url.as_deref().unwrap().ends_with("Setup.exe"));
    }

    #[test]
    fn an_older_release_is_not_an_update() {
        let payload = r#"{"tag_name": "v0.1.0", "assets": []}"#;
        let info = summarize(payload, "0.1.0").expect("应当解析成功");
        assert!(!info.update_available);
        assert!(info.asset_name.is_none());
    }

    #[test]
    fn repository_shape_is_validated() {
        assert!(validate_repository("lq/qingjian").is_ok());
        assert!(validate_repository("lq/qing.jian_v2").is_ok());
        assert!(validate_repository("lq").is_err());
        assert!(validate_repository("lq/qingjian/extra").is_err());
        assert!(validate_repository("lq/qing jian").is_err());
        assert!(validate_repository("../etc/passwd").is_err());
    }

    #[test]
    fn non_github_downloads_are_refused() {
        let payload = r#"{"tag_name": "v9.9.9", "assets": [{"name": "evil.exe", "browser_download_url": "https://evil.example/evil.exe"}]}"#;
        let info = summarize(payload, "0.1.0").expect("应当解析成功");
        assert!(info.update_available);
        assert!(info.asset_url.as_deref().unwrap().starts_with("https://evil.example"));
        // 解析层不拦截，拦截在下发下载命令时做——这里只确认地址被如实带出来
        assert!(!download_url_is_allowed(info.asset_url.as_deref().unwrap()));
    }

    #[test]
    fn external_links_are_a_whitelist_too() {
        assert!(external_url_is_allowed("https://github.com/lq/qingjian"));
        assert!(external_url_is_allowed("https://gitee.com/lq/qingjian"));
        assert!(!external_url_is_allowed("https://evil.example/"));
        // 是前缀白名单，不是「包含」——否则经过一个绕过域名就能混进来
        assert!(!external_url_is_allowed("https://evil.example/?x=https://github.com/"));
        assert!(!external_url_is_allowed("http://github.com/lq/qingjian"));
    }
}
