use std::sync::Mutex;

use sqlx::SqlitePool;

/// Application-wide state handed to every Tauri command via `State<AppState>`.
pub struct AppState {
    pub pool: SqlitePool,
    /// Set when the database had to be rebuilt at startup.
    ///
    /// It is read once by the UI and then cleared, so the explanation is shown
    /// exactly once rather than on every launch.
    pub startup_notice: Mutex<Option<String>>,
    /// 启动参数里那个要打开的文件，等前端来取。
    ///
    /// 双击 `.md` 时系统会带着文件路径拉起进程，但那时窗口还没建好、前端也没
    /// 跑起来，所以先存在这儿（见 `cli::markdown_path_in_args`）。
    pub pending_open: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(pool: SqlitePool, startup_notice: Option<String>) -> Self {
        Self {
            pool,
            startup_notice: Mutex::new(startup_notice),
            pending_open: Mutex::new(None),
        }
    }

    /// 记下启动参数里要打开的文件。
    pub fn remember_open_request(&self, path: Option<String>) {
        if let Ok(mut slot) = self.pending_open.lock() {
            *slot = path;
        }
    }
}

/// Hands the startup explanation to the UI, clearing it so it is not repeated.
#[tauri::command]
pub fn take_startup_notice(state: tauri::State<'_, AppState>) -> Option<String> {
    state
        .startup_notice
        .lock()
        .ok()
        .and_then(|mut notice| notice.take())
}

/// 交出启动参数里要打开的文件，同样取一次就清空。
#[tauri::command]
pub fn take_open_file(state: tauri::State<'_, AppState>) -> Option<String> {
    state
        .pending_open
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}
