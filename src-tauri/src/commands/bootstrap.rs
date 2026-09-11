use std::path::Path;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::commands::note::save_note_impl;
use crate::commands::workspace::sync;
use crate::error::{AppError, AppResult};
use crate::models::Workspace;
use crate::repo;
use crate::services;
use crate::state::AppState;

/// Workspace folder created inside the user's documents directory on first run.
const DEFAULT_WORKSPACE_DIR: &str = "青简";
const WELCOME_FILE: &str = "欢迎使用青简.md";

const WELCOME: &str = include_str!("../../templates/welcome.md");

/// Seeds a default workspace with a tour document the first time the app runs.
///
/// Returns `None` when any workspace already exists, so this is a one-shot:
/// deleting the welcome note later will not bring it back.
pub async fn bootstrap_workspace_impl(
    pool: &SqlitePool,
    parent: &Path,
) -> AppResult<Option<Workspace>> {
    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM workspace")
        .fetch_one(pool)
        .await?;
    if existing > 0 {
        return Ok(None);
    }

    let root = parent.join(DEFAULT_WORKSPACE_DIR);
    std::fs::create_dir_all(&root)?;

    let welcome_path = root.join(WELCOME_FILE);
    if !welcome_path.exists() {
        services::atomic_write(&welcome_path, WELCOME)?;
    }

    let workspace_id: i64 = sqlx::query_scalar(
        "INSERT INTO workspace (name, root_path, last_opened_at) VALUES (?, ?, unixepoch()) \
         RETURNING id",
    )
    .bind(DEFAULT_WORKSPACE_DIR)
    .bind(root.to_string_lossy().to_string())
    .fetch_one(pool)
    .await?;

    sync(pool, workspace_id).await?;

    // `sync` only knows file names, so route the welcome text through the normal
    // save path to derive its title and fill the search index immediately.
    if let Some(note) = repo::list_notes(pool, workspace_id)
        .await?
        .into_iter()
        .find(|note| note.rel_path == WELCOME_FILE)
    {
        save_note_impl(pool, note.id, WELCOME, None).await?;
    }

    repo::fetch_workspace(pool, workspace_id).await.map(Some)
}

#[tauri::command]
pub async fn bootstrap_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<Workspace>> {
    // Documents is where users expect to find their notes; the app data
    // directory is only a fallback for systems without one.
    let parent = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| AppError::Message(format!("无法定位默认目录：{error}")))?;

    bootstrap_workspace_impl(&state.pool, &parent).await
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
    async fn first_run_creates_a_workspace_with_the_welcome_note() {
        let parent = TempDir::new("bootstrap");
        let data_dir = TempDir::new("bootstrap-data");
        let pool = crate::db::init_pool(data_dir.path()).await.expect("init pool");

        let workspace = bootstrap_workspace_impl(&pool, parent.path())
            .await
            .expect("bootstrap")
            .expect("first run should seed a workspace");

        assert_eq!(workspace.name, DEFAULT_WORKSPACE_DIR);

        let welcome = parent.path().join(DEFAULT_WORKSPACE_DIR).join(WELCOME_FILE);
        assert!(welcome.exists(), "welcome note should be written to disk");

        let notes = repo::list_notes(&pool, workspace.id).await.expect("list notes");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].rel_path, WELCOME_FILE);
        // The title comes from the heading, not the file name.
        assert_eq!(notes[0].title, "欢迎使用青简");

        // Seeded text is searchable right away.
        let hits = crate::commands::note::search_notes_impl(&pool, Some(workspace.id), "公式")
            .await
            .expect("search");
        assert_eq!(hits.len(), 1, "welcome note should be indexed");
    }

    #[tokio::test]
    async fn bootstrap_is_a_one_shot() {
        let parent = TempDir::new("bootstrap-once");
        let data_dir = TempDir::new("bootstrap-once-data");
        let pool = crate::db::init_pool(data_dir.path()).await.expect("init pool");

        assert!(bootstrap_workspace_impl(&pool, parent.path())
            .await
            .expect("bootstrap")
            .is_some());
        assert!(
            bootstrap_workspace_impl(&pool, parent.path())
                .await
                .expect("bootstrap")
                .is_none(),
            "a second run must not seed again"
        );
    }
}
