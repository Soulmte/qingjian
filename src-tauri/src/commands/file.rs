use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::services;

/// Writes the given text to an absolute path the user picked in a native save
/// dialog, and returns the path that was written.
///
/// This backs "另存为" / 导出: the note model is workspace-relative, so a copy
/// that leaves the workspace cannot go through `save_note`. The dialog is the
/// authorisation boundary — the path is still required to be absolute and the
/// write stays atomic, so an interrupted export cannot truncate an existing
/// file.
pub fn export_text_impl(path: &str, contents: &str) -> AppResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("导出路径为空".into()));
    }

    let target = PathBuf::from(trimmed);
    if !target.is_absolute() {
        return Err(AppError::Message("导出路径必须是绝对路径".into()));
    }
    if target.is_dir() {
        return Err(AppError::Message("导出路径是一个目录".into()));
    }

    services::atomic_write(&target, contents)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_text(path: String, contents: String) -> AppResult<String> {
    export_text_impl(&path, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("qingjian-{label}-{unique}.md"))
    }

    #[test]
    fn writes_the_file_and_reports_the_path() {
        let path = temp_path("export");
        let written = export_text_impl(&path.to_string_lossy(), "# 标题\n\n正文\n")
            .expect("export should succeed");

        assert_eq!(written, path.to_string_lossy());
        assert_eq!(
            std::fs::read_to_string(&path).expect("read back"),
            "# 标题\n\n正文\n"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn existing_file_is_replaced_whole() {
        let path = temp_path("export-overwrite");
        std::fs::write(&path, "旧的、非常长的内容".repeat(50)).expect("seed file");

        export_text_impl(&path.to_string_lossy(), "新").expect("export should succeed");
        assert_eq!(std::fs::read_to_string(&path).expect("read back"), "新");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_empty_and_relative_paths() {
        assert!(export_text_impl("   ", "x").is_err());
        assert!(export_text_impl("relative/path.md", "x").is_err());
    }

    #[test]
    fn rejects_a_directory() {
        let dir = std::env::temp_dir();
        assert!(export_text_impl(&dir.to_string_lossy(), "x").is_err());
    }
}
