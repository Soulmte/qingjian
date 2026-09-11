use std::path::Path;

use sqlx::{Row, SqlitePool};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{Note, NoteDetail, SaveOutcome, SearchHit};
use crate::repo;
use crate::search;
use crate::services;
use crate::state::AppState;

/// Characters shown around a search hit in the results list.
const SNIPPET_CHARS: usize = 90;
const SEARCH_LIMIT: i64 = 100;

/* -------------------------------------------------------------------------- */
/* Core logic                                                                  */
/*                                                                            */
/* These take `&SqlitePool` instead of `State`, which keeps the Tauri command  */
/* wrappers below trivial and lets the workflow tests drive the real logic.    */
/* -------------------------------------------------------------------------- */

/// Reads a note's metadata and body. The body always comes from disk, so an
/// edit made in another editor is picked up on reopen. The hash of what was read
/// travels with it, and is what the next save is checked against.
pub async fn read_note_impl(pool: &SqlitePool, id: i64) -> AppResult<NoteDetail> {
    let note = repo::fetch_note(pool, id).await?;
    let workspace = repo::fetch_workspace(pool, note.workspace_id).await?;
    let path = services::resolve_within(Path::new(&workspace.root_path), &note.rel_path)?;
    let content = services::read_text(&path)?;
    let hash = services::hash_content_lf(&content);

    Ok(NoteDetail {
        note,
        content,
        hash,
    })
}

/// The hash of a note's file as it is right now, or `None` when it has gone.
///
/// Used to notice an edit made in another editor while the document is open,
/// which is the only way to warn about it before the next save.
pub async fn note_hash_impl(pool: &SqlitePool, id: i64) -> AppResult<Option<String>> {
    let note = repo::fetch_note(pool, id).await?;
    let workspace = repo::fetch_workspace(pool, note.workspace_id).await?;
    let path = services::resolve_within(Path::new(&workspace.root_path), &note.rel_path)?;

    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(services::hash_file(&path)?))
}

/// Persists the editor buffer: writes the file atomically, refreshes the
/// derived title/hash, and re-indexes the note for search — all in one
/// transaction so the index cannot drift from the row.
///
/// `expected_hash` is the version the caller believes is on disk, as returned by
/// [`read_note_impl`]. When it no longer matches, nothing is written and a
/// conflict comes back instead: an edit made in another editor must never be
/// overwritten by a buffer that never saw it. Passing `None` skips the check,
/// which is what an explicit "overwrite" answer means.
pub async fn save_note_impl(
    pool: &SqlitePool,
    id: i64,
    content: &str,
    expected_hash: Option<&str>,
) -> AppResult<SaveOutcome> {
    let note = repo::fetch_note(pool, id).await?;
    let workspace = repo::fetch_workspace(pool, note.workspace_id).await?;
    let path = services::resolve_within(Path::new(&workspace.root_path), &note.rel_path)?;

    if let Some(expected) = expected_hash {
        let on_disk = if path.exists() {
            Some(services::hash_file(&path)?)
        } else {
            None
        };

        if on_disk.as_deref() != Some(expected) {
            return Ok(SaveOutcome::Conflict {
                disk_hash: on_disk.unwrap_or_default(),
            });
        }
    }

    // The editor always hands back LF, so a file that arrived with Windows
    // endings has to be converted back: otherwise a one-word edit rewrites every
    // line break in the file and shows up as a whole-file diff.
    let existing_ending = std::fs::read(&path)
        .map(|bytes| services::detect_line_ending(&bytes))
        .unwrap_or(services::LineEnding::Lf);

    services::atomic_write(&path, &services::apply_line_ending(content, existing_ending))?;

    let title = services::extract_title(content, &services::title_from_path(&note.rel_path));
    // Read back what was actually written rather than hashing the buffer: the
    // file may be CRLF now, and the baseline handed to the caller has to be the
    // one a later comparison will produce. One small read per save buys that.
    let hash = services::hash_file(&path)?;

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE note SET title = ?, content_hash = ?, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(&title)
    .bind(&hash)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    repo::index_note(&mut tx, id, &title, content, &note.rel_path).await?;
    tx.commit().await?;

    Ok(SaveOutcome::Saved {
        note: repo::fetch_note(pool, id).await?,
        hash,
    })
}

/// Creates a new Markdown file inside the workspace and returns its note row.
pub async fn create_note_impl(
    pool: &SqlitePool,
    workspace_id: i64,
    rel_path: &str,
) -> AppResult<Note> {
    let workspace = repo::fetch_workspace(pool, workspace_id).await?;
    let rel_path = services::normalize_markdown_path(rel_path);
    let path = services::resolve_within(Path::new(&workspace.root_path), &rel_path)?;

    if path.exists() {
        return Err(AppError::Message(format!("文件已存在：{rel_path}")));
    }

    let title = services::title_from_path(&rel_path);
    let content = format!("# {title}\n");
    services::atomic_write(&path, &content)?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO note (workspace_id, rel_path, title, content_hash) VALUES (?, ?, ?, ?) \
         RETURNING id",
    )
    .bind(workspace_id)
    .bind(&rel_path)
    .bind(&title)
    .bind(services::hash_content(&content))
    .fetch_one(pool)
    .await?;

    let mut conn = pool.acquire().await?;
    repo::index_note(&mut conn, id, &title, &content, &rel_path).await?;

    repo::fetch_note(pool, id).await
}

/// Moves a note's file on disk and updates the index. The new path is resolved
/// through the same workspace boundary check as every other path.
pub async fn rename_note_impl(
    pool: &SqlitePool,
    id: i64,
    new_rel_path: &str,
) -> AppResult<Note> {
    let note = repo::fetch_note(pool, id).await?;
    let workspace = repo::fetch_workspace(pool, note.workspace_id).await?;
    let root = Path::new(&workspace.root_path);

    let new_rel_path = services::normalize_markdown_path(new_rel_path);
    let old_path = services::resolve_within(root, &note.rel_path)?;
    let new_path = services::resolve_within(root, &new_rel_path)?;

    if new_path.exists() {
        return Err(AppError::Message(format!("目标文件已存在：{new_rel_path}")));
    }

    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&old_path, &new_path)?;

    let content = services::read_text(&new_path).unwrap_or_default();
    let title = services::extract_title(&content, &services::title_from_path(&new_rel_path));

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE note SET rel_path = ?, title = ?, content_hash = ?, updated_at = unixepoch() \
         WHERE id = ?",
    )
    .bind(&new_rel_path)
    .bind(&title)
    .bind(services::hash_content(&content))
    .bind(id)
    .execute(&mut *tx)
    .await?;
    repo::index_note(&mut tx, id, &title, &content, &new_rel_path).await?;
    tx.commit().await?;

    repo::fetch_note(pool, id).await
}

/// Deletes the file from disk and flags the row as deleted.
///
/// The file goes to the system recycle bin (see `services::delete_file`), so a
/// mis-click is recoverable. The row is kept only so the note can be excluded
/// from listings without re-scanning.
pub async fn delete_note_impl(pool: &SqlitePool, id: i64) -> AppResult<()> {
    let note = repo::fetch_note(pool, id).await?;
    let workspace = repo::fetch_workspace(pool, note.workspace_id).await?;
    let path = services::resolve_within(Path::new(&workspace.root_path), &note.rel_path)?;

    services::delete_file(&path)?;

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM note_fts WHERE note_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE note SET is_deleted = 1, updated_at = unixepoch() WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(())
}

/// Full-text search. `workspace_id` narrows the search to one workspace;
/// passing `None` searches every indexed note.
pub async fn search_notes_impl(
    pool: &SqlitePool,
    workspace_id: Option<i64>,
    query: &str,
) -> AppResult<Vec<SearchHit>> {
    let Some(match_expr) = search::to_match_query(query) else {
        return Ok(Vec::new());
    };

    let mut sql = String::from(
        "SELECT f.note_id AS note_id, f.raw AS raw, f.rel_path AS rel_path, \
                n.title AS title, n.workspace_id AS workspace_id \
         FROM note_fts f JOIN note n ON n.id = f.note_id \
         WHERE note_fts MATCH ? AND n.is_deleted = 0",
    );
    if workspace_id.is_some() {
        sql.push_str(" AND n.workspace_id = ?");
    }
    sql.push_str(" ORDER BY bm25(note_fts) LIMIT ?");

    let mut statement = sqlx::query(&sql).bind(&match_expr);
    if let Some(workspace_id) = workspace_id {
        statement = statement.bind(workspace_id);
    }
    statement = statement.bind(SEARCH_LIMIT);

    let rows = statement.fetch_all(pool).await?;

    let hits = rows
        .into_iter()
        .map(|row| {
            let raw: String = row.get("raw");
            SearchHit {
                note_id: row.get("note_id"),
                workspace_id: row.get("workspace_id"),
                title: row.get("title"),
                rel_path: row.get("rel_path"),
                snippet: search::make_snippet(&raw, query, SNIPPET_CHARS),
            }
        })
        .collect();

    Ok(hits)
}

/* -------------------------------------------------------------------------- */
/* Tauri commands                                                              */
/* -------------------------------------------------------------------------- */

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>, workspace_id: i64) -> AppResult<Vec<Note>> {
    repo::list_notes(&state.pool, workspace_id).await
}

#[tauri::command]
pub async fn read_note(state: State<'_, AppState>, id: i64) -> AppResult<NoteDetail> {
    read_note_impl(&state.pool, id).await
}

#[tauri::command]
pub async fn save_note(
    state: State<'_, AppState>,
    id: i64,
    content: String,
    expected_hash: Option<String>,
) -> AppResult<SaveOutcome> {
    save_note_impl(&state.pool, id, &content, expected_hash.as_deref()).await
}

#[tauri::command]
pub async fn note_hash(state: State<'_, AppState>, id: i64) -> AppResult<Option<String>> {
    note_hash_impl(&state.pool, id).await
}

#[tauri::command]
pub async fn create_note(
    state: State<'_, AppState>,
    workspace_id: i64,
    rel_path: String,
) -> AppResult<Note> {
    create_note_impl(&state.pool, workspace_id, &rel_path).await
}

#[tauri::command]
pub async fn rename_note(
    state: State<'_, AppState>,
    id: i64,
    new_rel_path: String,
) -> AppResult<Note> {
    rename_note_impl(&state.pool, id, &new_rel_path).await
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    delete_note_impl(&state.pool, id).await
}

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    workspace_id: Option<i64>,
    query: String,
) -> AppResult<Vec<SearchHit>> {
    search_notes_impl(&state.pool, workspace_id, &query).await
}

/* -------------------------------------------------------------------------- */
/* Workflow test                                                               */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::commands::workspace::sync;
    use crate::db;

    /// A throwaway directory that removes itself when the test ends.
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

    /// Drives the real files on disk through the same functions the commands
    /// call: index a folder, edit a note, search it in Chinese, rename, delete.
    #[tokio::test]
    async fn note_lifecycle_round_trip() {
        let workspace_dir = TempDir::new("workspace");
        let data_dir = TempDir::new("data");
        let pool = db::init_pool(data_dir.path()).await.expect("init pool");

        // Pre-existing files on disk.
        std::fs::write(workspace_dir.path().join("rust.md"), "# Rust 所有权\n").expect("seed note");
        std::fs::create_dir_all(workspace_dir.path().join("notes")).expect("nested dir");
        std::fs::write(
            workspace_dir.path().join("notes/keep.md"),
            "# 借用检查\n\n借用检查器在编译期工作。\n",
        )
        .expect("seed nested note");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");

        let indexed = sync(&pool, workspace_id).await.expect("sync workspace");
        assert_eq!(indexed, 2, "both markdown files should be indexed");

        let notes = repo::list_notes(&pool, workspace_id).await.expect("list notes");
        assert_eq!(notes.len(), 2);
        let nested = notes
            .iter()
            .find(|note| note.rel_path == "notes/keep.md")
            .expect("nested note indexed");
        assert_eq!(nested.title, "keep", "title comes from the file name before parsing");

        // Reading pulls the body from disk, not the database.
        let detail = read_note_impl(&pool, nested.id).await.expect("read note");
        assert!(detail.content.contains("借用检查器"));

        // Saving rewrites the file and re-derives the title from the heading.
        let saved = save_note_impl(&pool, nested.id, "# 借用检查\n\n新的正文内容。\n", None)
            .await
            .expect("save note");
        let SaveOutcome::Saved { note: saved, .. } = saved else {
            panic!("expected a save, got {saved:?}")
        };
        assert_eq!(saved.title, "借用检查");
        let on_disk =
            std::fs::read_to_string(workspace_dir.path().join("notes/keep.md")).expect("read disk");
        assert!(on_disk.contains("新的正文内容。"));

        // Chinese substring search finds the saved note and renders a snippet.
        let hits = search_notes_impl(&pool, Some(workspace_id), "正文")
            .await
            .expect("search");
        assert_eq!(hits.len(), 1, "expected exactly one hit, got {hits:?}");
        assert_eq!(hits[0].rel_path, "notes/keep.md");
        assert!(hits[0].snippet.contains("正文"));

        // A query with nothing searchable short-circuits.
        assert!(search_notes_impl(&pool, None, "   ").await.expect("search").is_empty());

        // Renaming moves the file and keeps the index in step.
        let renamed = rename_note_impl(&pool, nested.id, "归档/borrow")
            .await
            .expect("rename note");
        assert_eq!(renamed.rel_path, "归档/borrow.md");
        assert!(workspace_dir.path().join("归档/borrow.md").exists());
        assert!(!workspace_dir.path().join("notes/keep.md").exists());

        let after_rename = search_notes_impl(&pool, None, "正文").await.expect("search");
        assert_eq!(after_rename[0].rel_path, "归档/borrow.md");

        // Deleting removes the file and drops it out of search.
        delete_note_impl(&pool, nested.id).await.expect("delete note");
        assert!(!workspace_dir.path().join("归档/borrow.md").exists());
        assert!(search_notes_impl(&pool, None, "正文").await.expect("search").is_empty());

        let remaining = repo::list_notes(&pool, workspace_id).await.expect("list notes");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].rel_path, "rust.md");
    }

    /// An edit made in another editor must never be silently overwritten by a
    /// buffer that never saw it.
    #[tokio::test]
    async fn an_external_edit_blocks_the_next_save() {
        let workspace_dir = TempDir::new("conflict-workspace");
        let data_dir = TempDir::new("conflict-data");
        let pool = db::init_pool(data_dir.path()).await.expect("init pool");

        let path = workspace_dir.path().join("note.md");
        std::fs::write(&path, "# 原标题\n").expect("seed note");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");
        sync(&pool, workspace_id).await.expect("sync");
        let id = repo::list_notes(&pool, workspace_id).await.expect("list")[0].id;

        // What the editor last saw.
        let detail = read_note_impl(&pool, id).await.expect("read note");
        assert_eq!(
            services::hash_file(&path).expect("hash"),
            detail.hash,
            "the hash handed to the caller has to be the one the file has now"
        );

        // Somebody else writes the file meanwhile.
        std::fs::write(&path, "# 外部修改\n").expect("external write");

        let outcome = save_note_impl(&pool, id, "# 我的版本\n", Some(&detail.hash))
            .await
            .expect("save");
        assert!(
            matches!(outcome, SaveOutcome::Conflict { .. }),
            "expected a conflict, got {outcome:?}"
        );
        // The conflict means nothing was written.
        assert!(std::fs::read_to_string(&path)
            .expect("read")
            .contains("外部修改"));

        // Answering "overwrite" writes, which is what passing no hash means.
        let outcome = save_note_impl(&pool, id, "# 我的版本\n", None)
            .await
            .expect("save");
        assert!(matches!(outcome, SaveOutcome::Saved { .. }), "{outcome:?}");
        assert!(std::fs::read_to_string(&path)
            .expect("read")
            .contains("我的版本"));
    }

    /// The editor works in LF, so a CRLF file has to be recognised as unchanged
    /// rather than looking like an external edit on every save.
    #[tokio::test]
    async fn windows_line_endings_do_not_look_like_a_conflict() {
        let workspace_dir = TempDir::new("crlf-workspace");
        let data_dir = TempDir::new("crlf-data");
        let pool = db::init_pool(data_dir.path()).await.expect("init pool");

        let path = workspace_dir.path().join("crlf.md");
        std::fs::write(&path, "# 标题\r\n\r\n正文\r\n").expect("seed note");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");
        sync(&pool, workspace_id).await.expect("sync");
        let id = repo::list_notes(&pool, workspace_id).await.expect("list")[0].id;

        let detail = read_note_impl(&pool, id).await.expect("read note");

        // The same text with the line endings the editor produces.
        let outcome = save_note_impl(&pool, id, "# 标题\n\n正文\n", Some(&detail.hash))
            .await
            .expect("save");
        assert!(matches!(outcome, SaveOutcome::Saved { .. }), "{outcome:?}");
        // And the file kept its Windows endings.
        assert!(std::fs::read_to_string(&path).expect("read").contains("\r\n"));
    }

    /// A note whose file has gone is reported as such rather than as an error.
    #[tokio::test]
    async fn a_vanished_file_reports_no_hash() {
        let workspace_dir = TempDir::new("gone-workspace");
        let data_dir = TempDir::new("gone-data");
        let pool = db::init_pool(data_dir.path()).await.expect("init pool");

        let path = workspace_dir.path().join("gone.md");
        std::fs::write(&path, "# 标题\n").expect("seed note");
        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");
        sync(&pool, workspace_id).await.expect("sync");
        let id = repo::list_notes(&pool, workspace_id).await.expect("list")[0].id;

        std::fs::remove_file(&path).expect("remove");
        assert_eq!(note_hash_impl(&pool, id).await.expect("hash"), None);
    }

    /// A crafted path from the frontend must never escape the workspace.
    #[tokio::test]
    async fn traversal_outside_workspace_is_rejected() {
        let workspace_dir = TempDir::new("workspace");
        let data_dir = TempDir::new("data");
        let pool = db::init_pool(data_dir.path()).await.expect("init pool");

        let workspace_id: i64 = sqlx::query_scalar(
            "INSERT INTO workspace (name, root_path) VALUES (?, ?) RETURNING id",
        )
        .bind("测试工作区")
        .bind(workspace_dir.path().to_string_lossy().to_string())
        .fetch_one(&pool)
        .await
        .expect("insert workspace");

        let error = create_note_impl(&pool, workspace_id, "../escaped.md")
            .await
            .expect_err("traversal must be rejected");
        assert!(
            error.to_string().contains("越界") || error.to_string().contains("非法"),
            "unexpected error: {error}"
        );
    }
}
