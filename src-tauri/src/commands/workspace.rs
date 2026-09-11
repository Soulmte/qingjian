use std::path::Path;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{Note, Workspace};
use crate::repo;
use crate::services;
use crate::state::AppState;

/// Lets the asset protocol read files inside `root_path`.
///
/// The config ships an empty scope, so the webview can only reach folders the
/// user actually opened as a workspace — images outside them stay unreadable.
pub fn grant_asset_access(app: &AppHandle, root_path: &str) {
    if let Err(error) = app.asset_protocol_scope().allow_directory(root_path, true) {
        // A workspace outside the app's reach only costs image previews; the
        // file itself is still read and written through the Rust commands.
        eprintln!("无法为资源协议开放目录 {root_path}: {error}");
    }
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> AppResult<Vec<Workspace>> {
    let workspaces = sqlx::query_as::<_, Workspace>(
        "SELECT * FROM workspace ORDER BY COALESCE(last_opened_at, created_at) DESC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(workspaces)
}

/// Registers a folder as a workspace and indexes the Markdown files inside it.
/// Re-adding an already known folder only refreshes `last_opened_at`.
#[tauri::command]
pub async fn add_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    root_path: String,
) -> AppResult<Workspace> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err(AppError::Message(format!("所选路径不是文件夹：{root_path}")));
    }

    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&root_path)
        .to_string();

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO workspace (name, root_path, last_opened_at) VALUES (?, ?, unixepoch()) \
         ON CONFLICT(root_path) DO UPDATE SET last_opened_at = unixepoch() \
         RETURNING id",
    )
    .bind(&name)
    .bind(&root_path)
    .fetch_one(&state.pool)
    .await?;

    // Images inside the folder only render once the protocol can read it.
    grant_asset_access(&app, &root_path);

    sync(&state.pool, id).await?;

    repo::fetch_workspace(&state.pool, id).await
}

#[tauri::command]
pub async fn remove_workspace(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    // Notes go away via ON DELETE CASCADE; the user's files on disk are left
    // untouched.
    sqlx::query("DELETE FROM workspace WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(())
}

/// Rescans the workspace folder: new files are added, files that disappeared
/// are flagged as deleted. Returns the up-to-date note list.
#[tauri::command]
pub async fn sync_workspace(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Note>> {
    sync(&state.pool, id).await?;
    repo::list_notes(&state.pool, id).await
}

/// Rebuilds the note index for one workspace. Anything not seen in the scan is
/// treated as removed from disk.
pub async fn sync(pool: &SqlitePool, workspace_id: i64) -> AppResult<usize> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let files = services::scan_markdown(Path::new(&workspace.root_path))?;

    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE note SET is_deleted = 1 WHERE workspace_id = ?")
        .bind(workspace_id)
        .execute(&mut *tx)
        .await?;

    for rel_path in &files {
        let title = services::title_from_path(rel_path);
        sqlx::query(
            "INSERT INTO note (workspace_id, rel_path, title) VALUES (?, ?, ?) \
             ON CONFLICT(workspace_id, rel_path) DO UPDATE SET is_deleted = 0",
        )
        .bind(workspace_id)
        .bind(rel_path)
        .bind(&title)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(files.len())
}
