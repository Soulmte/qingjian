use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::repo;
use crate::services;
use crate::state::AppState;

/// Upper bound for a single pasted image, so a huge clipboard payload cannot
/// fill the workspace by accident.
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

/// Extensions accepted when the clipboard carries a file path rather than
/// bytes. Keeps a stray paste from reading an arbitrary file off the disk.
const IMAGE_EXTENSIONS: [&str; 11] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico", "tif", "tiff",
];

/// Writes a pasted or dropped image into the workspace and returns the
/// workspace-relative path (forward slashes) to reference from Markdown.
///
/// `dir` is the user-configured folder (e.g. `assets`); both it and the file
/// name are normalised and then checked against the workspace boundary, so a
/// crafted name cannot escape the folder.
pub async fn save_image_impl(
    pool: &SqlitePool,
    workspace_id: i64,
    dir: &str,
    file_name: &str,
    data: &[u8],
) -> AppResult<String> {
    if data.is_empty() {
        return Err(AppError::Message("图片内容为空".into()));
    }
    if data.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Message(format!(
            "图片过大（{} MB），上限为 {} MB",
            data.len() / 1024 / 1024,
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }

    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let dir = services::normalize_relative_dir(dir);
    let file_name = services::sanitize_file_name(file_name);

    let rel_path = if dir.is_empty() {
        file_name
    } else {
        format!("{dir}/{file_name}")
    };

    let path = services::resolve_within(Path::new(&workspace.root_path), &rel_path)?;
    services::atomic_write_bytes(&path, data)?;

    Ok(rel_path)
}

/* -------------------------------------------------------------------------- */
/* Reading an image the clipboard only points at                               */
/* -------------------------------------------------------------------------- */

/// A downloaded or read image, with the MIME type needed to name the file.
#[derive(Debug, serde::Serialize)]
pub struct FetchedImage {
    pub data: Vec<u8>,
    pub mime: String,
}

/// Where an image reference the user pasted points.
#[derive(Debug, PartialEq, Eq)]
pub enum ImageSource {
    Remote(String),
    Local(PathBuf),
}

/// Classifies what the clipboard put in its `text/html` or `text/plain` half.
///
/// Copying an image from a web page stores only its address, and apps disagree
/// on which flavour carries it, so both an `http(s)` URL and a local path have
/// to be recognised. Anything else is rejected rather than fetched.
pub fn classify_image_source(source: &str) -> AppResult<ImageSource> {
    let trimmed = source.trim().trim_matches(['"', '\'']).trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("图片地址为空".into()));
    }

    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("https://") || lowered.starts_with("http://") {
        return Ok(ImageSource::Remote(trimmed.to_string()));
    }

    if lowered.starts_with("file://") {
        // `file:///C:/a.png` keeps a slash before the drive letter that Windows
        // does not want; `file://host/share/a.png` is a UNC path as written.
        let decoded = percent_decode(&trimmed[7..]);
        return local_source(strip_drive_slash(decoded));
    }

    if Path::new(trimmed).is_absolute() {
        return local_source(trimmed.to_string());
    }

    Err(AppError::Message(format!("无法识别的图片地址：{source}")))
}

fn local_source(path: String) -> AppResult<ImageSource> {
    let candidate = PathBuf::from(&path);
    let is_image = candidate
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);

    if !is_image {
        return Err(AppError::Message(format!("只支持图片文件：{path}")));
    }
    Ok(ImageSource::Local(candidate))
}

/// Reads the bytes behind an image reference.
///
/// The fetch happens here rather than in the webview: the page runs without a
/// CSP, and a cross-origin read from the frontend would be blocked by CORS
/// anyway. Remote responses are size-capped while being read.
pub fn fetch_image_impl(source: &str) -> AppResult<FetchedImage> {
    match classify_image_source(source)? {
        ImageSource::Remote(url) => fetch_remote(&url),
        ImageSource::Local(path) => {
            if !path.is_file() {
                return Err(AppError::Message(format!("文件不存在：{}", path.display())));
            }
            let data = std::fs::read(&path)?;
            ensure_size(data.len())?;
            let mime = guess_mime(&data, &path.to_string_lossy());
            Ok(FetchedImage { data, mime })
        }
    }
}

fn fetch_remote(url: &str) -> AppResult<FetchedImage> {
    let agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent("qingjian")
        .build()
        .new_agent();

    let response = agent
        .get(url)
        .header("Accept", "image/*,*/*;q=0.8")
        .call()
        .map_err(|error| AppError::Message(format!("无法下载图片：{error}")))?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(AppError::Message(format!("下载图片失败（HTTP {status}）")));
    }

    let hint = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    // Reading one byte past the cap lets an oversized body be rejected without
    // ever holding the whole thing in memory.
    let mut body = response.into_body();
    let data = body
        .with_config()
        .limit(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_vec()
        .map_err(|error| AppError::Message(format!("读取图片失败：{error}")))?;

    ensure_size(data.len())?;
    let mime = guess_mime(&data, &hint);
    Ok(FetchedImage { data, mime })
}

fn ensure_size(len: usize) -> AppResult<()> {
    if len == 0 {
        return Err(AppError::Message("图片内容为空".into()));
    }
    if len > MAX_IMAGE_BYTES {
        return Err(AppError::Message(format!(
            "图片过大（{} MB），上限为 {} MB",
            len / 1024 / 1024,
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}

/// Sniffs the format, falling back to the supplied hint (a `Content-Type` or a
/// file name). Magic bytes win because servers mislabel images surprisingly
/// often.
fn guess_mime(bytes: &[u8], hint: &str) -> String {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return "image/png".into();
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return "image/jpeg".into();
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "image/gif".into();
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp".into();
    }
    if bytes.starts_with(b"BM") {
        return "image/bmp".into();
    }

    let lowered = hint.to_ascii_lowercase();
    let declared = lowered.split(';').next().unwrap_or("").trim();
    if declared.starts_with("image/") {
        return declared.to_string();
    }

    match Path::new(&lowered).extension().and_then(|ext| ext.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "image/png",
    }
    .to_string()
}

/// Decodes `%XX` escapes. Invalid escapes are left alone, which is more useful
/// than failing on a path that only looks percent-encoded.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// `file:///C:/a.png` arrives as `/C:/a.png`; the leading slash is stripped
/// only when a drive letter follows, so POSIX paths keep theirs.
fn strip_drive_slash(path: String) -> String {
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0] == b'/'
        && bytes[1].is_ascii_alphabetic()
        && bytes[2] == b':'
    {
        return path[1..].to_string();
    }
    path
}

#[tauri::command]
pub async fn save_image(
    state: State<'_, AppState>,
    workspace_id: i64,
    dir: String,
    file_name: String,
    data: Vec<u8>,
) -> AppResult<String> {
    save_image_impl(&state.pool, workspace_id, &dir, &file_name, &data).await
}

/// Reads an image the clipboard only pointed at, so it can be stored through
/// the same path as a copied one.
#[tauri::command]
pub async fn fetch_image_source(source: String) -> AppResult<FetchedImage> {
    // ureq is blocking; keeping it off the async runtime's worker threads stops a
    // slow download from stalling every other command.
    tauri::async_runtime::spawn_blocking(move || fetch_image_impl(&source))
        .await
        .map_err(|error| AppError::Message(format!("下载任务失败：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default();
            let path = std::env::temp_dir().join(format!("qingjian-{label}-{unique}"));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn pasted_image_is_written_into_the_workspace() {
        let workspace_dir = TempDir::new("assets-workspace");
        let data_dir = TempDir::new("assets-data");
        let pool = crate::db::init_pool(data_dir.path()).await.expect("init pool");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");

        let bytes = [0x89u8, 0x50, 0x4e, 0x47];
        let rel = save_image_impl(&pool, workspace_id, "/assets/", "paste-1.png", &bytes)
            .await
            .expect("save image");

        assert_eq!(rel, "assets/paste-1.png");
        let written =
            std::fs::read(workspace_dir.path().join("assets/paste-1.png")).expect("read back");
        assert_eq!(written, bytes);
    }

    #[tokio::test]
    async fn image_path_cannot_escape_the_workspace() {
        let workspace_dir = TempDir::new("assets-escape");
        let data_dir = TempDir::new("assets-escape-data");
        let pool = crate::db::init_pool(data_dir.path()).await.expect("init pool");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");

        let error = save_image_impl(&pool, workspace_id, "../outside", "x.png", &[1, 2, 3])
            .await
            .expect_err("traversal must be rejected");
        assert!(
            error.to_string().contains("越界") || error.to_string().contains("非法"),
            "unexpected error: {error}"
        );

        // An empty payload is rejected before touching the disk.
        assert!(save_image_impl(&pool, workspace_id, "assets", "x.png", &[])
            .await
            .is_err());
    }

    #[test]
    fn classify_recognises_urls_and_rejects_anything_else() {
        assert_eq!(
            classify_image_source("https://example.com/a.png").expect("remote"),
            ImageSource::Remote("https://example.com/a.png".into())
        );
        assert_eq!(
            classify_image_source("  \"https://example.com/a.png\"  ").expect("quoted"),
            ImageSource::Remote("https://example.com/a.png".into())
        );

        for bad in [
            "",
            "   ",
            "example.com/a.png",
            "javascript:alert(1)",
            "ftp://example.com/a.png",
            "data:image/png;base64,AAAA",
        ] {
            assert!(classify_image_source(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn file_urls_lose_their_scheme_and_drive_slash() {
        assert_eq!(strip_drive_slash("/C:/img/a.png".to_string()), "C:/img/a.png");
        assert_eq!(strip_drive_slash("/home/me/a.png".to_string()), "/home/me/a.png");

        assert_eq!(
            classify_image_source("file:///C:/img/a.png").expect("file url"),
            ImageSource::Local(PathBuf::from("C:/img/a.png"))
        );
        assert_eq!(
            classify_image_source("file:///home/a%20b/c.png").expect("encoded file url"),
            ImageSource::Local(PathBuf::from("/home/a b/c.png"))
        );
    }

    #[test]
    fn a_bare_path_must_look_like_an_image() {
        let png = std::env::temp_dir().join("qingjian-source-a.png");
        assert_eq!(
            classify_image_source(&png.to_string_lossy()).expect("absolute image path"),
            ImageSource::Local(png)
        );

        assert!(classify_image_source("file:///C:/Windows/System32/drivers/etc/hosts").is_err());
    }

    #[test]
    fn mime_is_sniffed_before_the_hint_is_trusted() {
        assert_eq!(
            guess_mime(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a], "text/plain"),
            "image/png"
        );
        assert_eq!(guess_mime(&[0xff, 0xd8, 0xff, 0xe0], ""), "image/jpeg");
        assert_eq!(guess_mime(b"GIF89a....", ""), "image/gif");
        assert_eq!(guess_mime(b"RIFF....WEBPVP8 ", ""), "image/webp");
        assert_eq!(guess_mime(b"BM12345", "image/x-bmp"), "image/bmp");

        // The hint only decides when the bytes say nothing.
        assert_eq!(guess_mime(b"<svg xmlns=\"x\">", "image/svg+xml"), "image/svg+xml");
        assert_eq!(guess_mime(b"<svg>", "a/b.svg"), "image/svg+xml");
        assert_eq!(guess_mime(b"???", "image/webp; charset=binary"), "image/webp");
        assert_eq!(guess_mime(b"???", "unknown"), "image/png");
    }

    #[test]
    fn percent_decoding_keeps_what_it_cannot_decode() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("%E4%B8%AD"), "中");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
    }
}
