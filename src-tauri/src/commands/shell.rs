//! 与系统外壳打交道的那点事。
//!
//! 目前只有「用默认浏览器打开一个链接」——「设置 → 关于」里的仓库地址、更新弹窗
//! 里的发布页都走它。
//!
//! 自动更新本身不在这里：它交给 `tauri-plugin-updater`（见 `lib.rs` 与
//! `tauri.conf.json` 的 `plugins.updater`）。官方实现会校验更新包的签名，那是
//! 自己手写一遍很难做对、也最不该省的一步。

use std::path::Path;

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::repo;
use crate::services;
use crate::state::AppState;

/// 允许在外部浏览器里打开的站点。
///
/// 是白名单而不是「随便什么 URL」：这条命令的本意是让界面能跳到项目自己的页面，
/// 收窄范围之后它就没法被当成一个通用的跳转口子使用。
fn external_url_is_allowed(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("https://gitee.com/")
}

/// 在系统默认浏览器里打开一个链接。
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    if !external_url_is_allowed(&url) {
        return Err(AppError::Message(format!("不接受这个地址：{url}")));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Message(format!("无法打开链接：{error}")))
}

/// 在系统文件管理器里定位工作区内的一个路径（文件或文件夹）。
///
/// 路径在 Rust 侧解析并做越界检查，前端只给相对路径——和读写笔记走同一套
/// 边界规则，界面无权让资源管理器跳到工作区之外。空路径代表工作区根目录。
#[tauri::command]
pub async fn reveal_in_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: i64,
    rel_path: String,
) -> AppResult<()> {
    let workspace = repo::fetch_workspace(&state.pool, workspace_id).await?;
    let root = Path::new(&workspace.root_path);

    let trimmed = rel_path.trim();
    let target = if trimmed.is_empty() {
        root.to_path_buf()
    } else {
        services::resolve_within(root, trimmed)?
    };

    if !target.exists() {
        return Err(AppError::Message(format!("路径不存在：{}", target.display())));
    }

    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|error| AppError::Message(format!("无法打开文件管理器：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_links_are_a_whitelist() {
        assert!(external_url_is_allowed("https://github.com/Soulmte/qingjian"));
        assert!(external_url_is_allowed("https://gitee.com/Soulmte/qingjian"));
        assert!(!external_url_is_allowed("https://evil.example/"));
        // 前缀白名单，不是「包含」——否则经过一个绕过域名就能混进来
        assert!(!external_url_is_allowed("https://evil.example/?x=https://github.com/"));
        assert!(!external_url_is_allowed("http://github.com/Soulmte/qingjian"));
    }
}
