use std::path::Path;

use sqlx::{Row, SqlitePool};
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

/// The workspace's layout fingerprint, for the sidebar's poll. See
/// [`services::workspace_signature`].
#[tauri::command]
pub async fn workspace_signature(state: State<'_, AppState>, id: i64) -> AppResult<String> {
    let workspace = repo::fetch_workspace(&state.pool, id).await?;
    services::workspace_signature(Path::new(&workspace.root_path))
}

/// The workspace's subfolders, so the sidebar can show the ones that hold no
/// notes yet. An empty folder created from the context menu would otherwise
/// vanish until something was put inside it.
#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>, id: i64) -> AppResult<Vec<String>> {
    list_folders_impl(&state.pool, id).await
}

pub async fn list_folders_impl(pool: &SqlitePool, workspace_id: i64) -> AppResult<Vec<String>> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    services::scan_directories(Path::new(&workspace.root_path))
}

/// Creates a folder inside the workspace; `rel_dir` may be nested. Returns the
/// normalised path so the caller can refresh against the same string.
#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    id: i64,
    rel_dir: String,
) -> AppResult<String> {
    create_folder_impl(&state.pool, id, &rel_dir).await
}

pub async fn create_folder_impl(
    pool: &SqlitePool,
    workspace_id: i64,
    rel_dir: &str,
) -> AppResult<String> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let rel_dir = services::normalize_relative_dir(rel_dir);
    if rel_dir.is_empty() {
        return Err(AppError::Message("文件夹名不能为空".to_string()));
    }

    // Same boundary check as every other path: a typed `..` cannot escape.
    let path = services::resolve_within(Path::new(&workspace.root_path), &rel_dir)?;
    if path.exists() {
        return Err(AppError::Message(format!("已存在同名文件或文件夹：{rel_dir}")));
    }

    std::fs::create_dir_all(&path)?;
    Ok(rel_dir)
}

/// Renames (or moves) a folder and re-points every note inside it.
///
/// Notes are addressed by workspace-relative path, so moving the directory on
/// disk without rewriting those paths would leave every note inside it pointing
/// at a file that is no longer there.
#[tauri::command]
pub async fn rename_folder(
    state: State<'_, AppState>,
    id: i64,
    rel_dir: String,
    new_rel_dir: String,
) -> AppResult<String> {
    rename_folder_impl(&state.pool, id, &rel_dir, &new_rel_dir).await
}

pub async fn rename_folder_impl(
    pool: &SqlitePool,
    workspace_id: i64,
    rel_dir: &str,
    new_rel_dir: &str,
) -> AppResult<String> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let root = Path::new(&workspace.root_path);

    let old_rel = services::normalize_relative_dir(rel_dir);
    let new_rel = services::normalize_relative_dir(new_rel_dir);
    if old_rel.is_empty() || new_rel.is_empty() {
        return Err(AppError::Message("文件夹名不能为空".to_string()));
    }
    if old_rel == new_rel {
        return Ok(new_rel);
    }

    let old_path = services::resolve_within(root, &old_rel)?;
    let new_path = services::resolve_within(root, &new_rel)?;
    if !old_path.is_dir() {
        return Err(AppError::Message(format!("文件夹不存在：{old_rel}")));
    }
    if new_path.exists() {
        return Err(AppError::Message(format!("已存在同名文件或文件夹：{new_rel}")));
    }
    // Moving a folder inside itself would swallow the whole subtree.
    if new_rel.starts_with(&format!("{old_rel}/")) {
        return Err(AppError::Message("不能把文件夹移动到它自己里面".to_string()));
    }

    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&old_path, &new_path)?;

    // Every note at or below the folder. Filtered in Rust rather than with a
    // `LIKE` prefix, because a folder name may contain `%` or `_`.
    let rows = sqlx::query(
        "SELECT id, rel_path, title FROM note WHERE workspace_id = ? AND is_deleted = 0",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;

    let prefix = format!("{old_rel}/");
    let mut tx = pool.begin().await?;
    for row in rows {
        let rel_path: String = row.get("rel_path");
        let Some(suffix) = rel_path.strip_prefix(&prefix) else {
            continue;
        };

        let note_id: i64 = row.get("id");
        let title: String = row.get("title");
        let moved = format!("{new_rel}/{suffix}");

        let path = services::resolve_within(root, &moved)?;
        let content = services::read_text(&path).unwrap_or_default();
        let hash = services::hash_file(&path).unwrap_or_default();

        sqlx::query(
            "UPDATE note SET rel_path = ?, content_hash = ?, updated_at = unixepoch() WHERE id = ?",
        )
        .bind(&moved)
        .bind(&hash)
        .bind(note_id)
        .execute(&mut *tx)
        .await?;
        repo::index_note(&mut tx, note_id, &title, &content, &moved).await?;
    }
    tx.commit().await?;

    Ok(new_rel)
}

/// Moves a folder and everything in it to the recycle bin, and drops its notes
/// out of the index.
#[tauri::command]
pub async fn delete_folder(
    state: State<'_, AppState>,
    id: i64,
    rel_dir: String,
) -> AppResult<()> {
    delete_folder_impl(&state.pool, id, &rel_dir).await
}

pub async fn delete_folder_impl(
    pool: &SqlitePool,
    workspace_id: i64,
    rel_dir: &str,
) -> AppResult<()> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let root = Path::new(&workspace.root_path);

    let rel_dir = services::normalize_relative_dir(rel_dir);
    // The workspace root is not a folder to delete.
    if rel_dir.is_empty() {
        return Err(AppError::Message("不能删除工作区目录".to_string()));
    }

    let path = services::resolve_within(root, &rel_dir)?;
    if !path.is_dir() {
        return Err(AppError::Message(format!("文件夹不存在：{rel_dir}")));
    }

    services::delete_directory(&path)?;

    let prefix = format!("{rel_dir}/");
    let rows = sqlx::query("SELECT id, rel_path FROM note WHERE workspace_id = ? AND is_deleted = 0")
        .bind(workspace_id)
        .fetch_all(pool)
        .await?;

    let mut tx = pool.begin().await?;
    for row in rows {
        let rel_path: String = row.get("rel_path");
        if !rel_path.starts_with(&prefix) {
            continue;
        }

        let note_id: i64 = row.get("id");
        sqlx::query("DELETE FROM note_fts WHERE note_id = ?")
            .bind(note_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE note SET is_deleted = 1, updated_at = unixepoch() WHERE id = ?")
            .bind(note_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::commands::note::search_notes_impl;
    use crate::db;

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

    async fn workspace_at(root: &Path) -> (SqlitePool, i64) {
        let data = TempDir::new("workspace-data");
        let pool = db::init_pool(data.path()).await.expect("init pool");
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(root.to_string_lossy().into_owned())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");
        (pool, id)
    }

    #[tokio::test]
    async fn create_folder_makes_the_directory_and_reports_it() {
        let root = TempDir::new("create-folder");
        let (pool, id) = workspace_at(root.path()).await;

        let created = create_folder_impl(&pool, id, "docs/notes")
            .await
            .expect("create folder");
        assert_eq!(created, "docs/notes");
        assert!(root.path().join("docs/notes").is_dir());

        // It has to be listed, or the sidebar would never show it.
        let listed = list_folders_impl(&pool, id).await.expect("list folders");
        assert_eq!(listed, vec!["docs".to_string(), "docs/notes".to_string()]);
    }

    #[tokio::test]
    async fn create_folder_refuses_an_existing_path_and_traversal() {
        let root = TempDir::new("reject-folder");
        let (pool, id) = workspace_at(root.path()).await;

        create_folder_impl(&pool, id, "notes").await.expect("first create");
        assert!(create_folder_impl(&pool, id, "notes").await.is_err());

        // A name that cannot be empty, and one that tries to climb out.
        assert!(create_folder_impl(&pool, id, "   ").await.is_err());
        assert!(create_folder_impl(&pool, id, "../escape").await.is_err());
        assert!(!root.path().parent().unwrap().join("escape").exists());
    }

    #[tokio::test]
    async fn renaming_a_folder_moves_the_notes_with_it() {
        let root = TempDir::new("rename-folder");
        std::fs::create_dir_all(root.path().join("docs/sub")).unwrap();
        std::fs::write(root.path().join("docs/a.md"), "# 甲\n").unwrap();
        std::fs::write(root.path().join("docs/sub/b.md"), "# 乙\n").unwrap();
        std::fs::write(root.path().join("keep.md"), "# 保留\n").unwrap();

        let (pool, id) = workspace_at(root.path()).await;
        sync(&pool, id).await.expect("sync");

        let renamed = rename_folder_impl(&pool, id, "docs", "归档")
            .await
            .expect("rename folder");
        assert_eq!(renamed, "归档");

        // The tree moved on disk…
        assert!(root.path().join("归档/a.md").is_file());
        assert!(root.path().join("归档/sub/b.md").is_file());
        assert!(!root.path().join("docs").exists());

        // …every note points at its new home, and the outsider is untouched.
        let mut paths: Vec<String> = repo::list_notes(&pool, id)
            .await
            .expect("list")
            .into_iter()
            .map(|note| note.rel_path)
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["keep.md", "归档/a.md", "归档/sub/b.md"]);

        // Search follows the new path rather than the old one.
        let hits = search_notes_impl(&pool, Some(id), "乙").await.expect("search");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rel_path, "归档/sub/b.md");
    }

    #[tokio::test]
    async fn renaming_a_folder_refuses_a_collision_or_a_self_move() {
        let root = TempDir::new("rename-folder-reject");
        std::fs::create_dir_all(root.path().join("docs/sub")).unwrap();
        std::fs::write(root.path().join("docs/a.md"), "# 甲\n").unwrap();
        std::fs::create_dir_all(root.path().join("other")).unwrap();

        let (pool, id) = workspace_at(root.path()).await;

        assert!(rename_folder_impl(&pool, id, "docs", "other").await.is_err());
        assert!(rename_folder_impl(&pool, id, "docs", "docs/sub").await.is_err());
        assert!(rename_folder_impl(&pool, id, "missing", "x").await.is_err());

        // Nothing moved.
        assert!(root.path().join("docs/a.md").is_file());
        assert!(!root.path().join("docs/sub/docs").exists());
    }

    #[tokio::test]
    async fn deleting_a_folder_takes_its_notes_out_of_the_index() {
        let root = TempDir::new("delete-folder");
        std::fs::create_dir_all(root.path().join("docs/sub")).unwrap();
        std::fs::write(root.path().join("docs/a.md"), "# 甲\n").unwrap();
        std::fs::write(root.path().join("docs/sub/b.md"), "# 乙\n").unwrap();
        std::fs::write(root.path().join("keep.md"), "# 保留\n").unwrap();

        let (pool, id) = workspace_at(root.path()).await;
        sync(&pool, id).await.expect("sync");

        delete_folder_impl(&pool, id, "docs")
            .await
            .expect("delete folder");

        assert!(!root.path().join("docs").exists());
        assert!(root.path().join("keep.md").is_file());

        let notes = repo::list_notes(&pool, id).await.expect("list");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].rel_path, "keep.md");

        // The folder is gone from search too, and the root is not deletable.
        assert!(search_notes_impl(&pool, Some(id), "乙")
            .await
            .expect("search")
            .is_empty());
        assert!(delete_folder_impl(&pool, id, "").await.is_err());
    }
}
