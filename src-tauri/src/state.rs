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
}

impl AppState {
    pub fn new(pool: SqlitePool, startup_notice: Option<String>) -> Self {
        Self {
            pool,
            startup_notice: Mutex::new(startup_notice),
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
