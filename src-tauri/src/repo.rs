use sqlx::{SqliteConnection, SqlitePool};

use crate::error::{AppError, AppResult};
use crate::models::{Note, Workspace};
use crate::search;

pub async fn fetch_workspace(pool: &SqlitePool, id: i64) -> AppResult<Workspace> {
    sqlx::query_as::<_, Workspace>("SELECT * FROM workspace WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Message(format!("工作区不存在：{id}")))
}

pub async fn fetch_note(pool: &SqlitePool, id: i64) -> AppResult<Note> {
    sqlx::query_as::<_, Note>("SELECT * FROM note WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Message(format!("笔记不存在：{id}")))
}

/// Lists the live notes of a workspace, pinned ones first.
pub async fn list_notes(pool: &SqlitePool, workspace_id: i64) -> AppResult<Vec<Note>> {
    let notes = sqlx::query_as::<_, Note>(
        "SELECT * FROM note WHERE workspace_id = ? AND is_deleted = 0 \
         ORDER BY pinned DESC, rel_path ASC",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;

    Ok(notes)
}

/// Replaces the search-index entry for one note. Callers must pass the same
/// connection/transaction that performed the metadata write so the index can
/// never drift from the row it describes.
pub async fn index_note(
    conn: &mut SqliteConnection,
    note_id: i64,
    title: &str,
    content: &str,
    rel_path: &str,
) -> AppResult<()> {
    sqlx::query("DELETE FROM note_fts WHERE note_id = ?")
        .bind(note_id)
        .execute(&mut *conn)
        .await?;

    sqlx::query(
        "INSERT INTO note_fts (note_id, title, content, raw, rel_path) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(note_id)
    .bind(search::to_index_text(title))
    .bind(search::to_index_text(content))
    .bind(content)
    .bind(rel_path)
    .execute(&mut *conn)
    .await?;

    Ok(())
}
