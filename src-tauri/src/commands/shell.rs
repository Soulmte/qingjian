//! 与系统外壳打交道的那点事。
//!
//! 目前只有「用默认浏览器打开一个链接」——「设置 → 关于」里的仓库地址、更新弹窗
//! 里的发布页都走它。
//!
//! 自动更新本身不在这里：它交给 `tauri-plugin-updater`（见 `lib.rs` 与
//! `tauri.conf.json` 的 `plugins.updater`）。官方实现会校验更新包的签名，那是
//! 自己手写一遍很难做对、也最不该省的一步。

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};

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
