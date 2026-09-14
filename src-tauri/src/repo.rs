use sqlx::{SqliteConnection, SqlitePool};

use crate::error::{AppError, AppResult};
use crate::models::{Note, NoteRevision, NoteRevisionDetail, Workspace};
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

/// 列表里一条版本需要的东西，比 `NoteRevision` 多带正文开头一段。
///
/// `substr` 是在 SQL 里截的：列表可能有几十条，把整篇正文拉回来只为了取第一行
/// 标题，一篇长笔记就能传出好几兆。
#[derive(sqlx::FromRow)]
struct RevisionRow {
    id: i64,
    note_id: i64,
    created_at: i64,
    size: i64,
    head: String,
}

impl RevisionRow {
    fn into_revision(self) -> NoteRevision {
        NoteRevision {
            id: self.id,
            note_id: self.note_id,
            created_at: self.created_at,
            size: self.size,
            preview: preview_of(&self.head),
        }
    }
}

/// 正文第一行非空文字，去掉 Markdown 标记头，截到能放在一行里。
///
/// 列表里得看得出「这是哪一版」，而开头那行通常就是标题。
pub(crate) fn preview_of(head: &str) -> String {
    const MAX: usize = 60;

    let line = head
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .trim_start_matches(['#', '>', '-', '*', '+', ' '])
        .trim();

    if line.chars().count() <= MAX {
        return line.to_string();
    }
    line.chars().take(MAX).collect::<String>() + "…"
}

/// 记一条历史版本。
///
/// 调用方负责先确认这确实是新内容：这个函数只管写。
pub async fn insert_revision(
    conn: &mut SqliteConnection,
    note_id: i64,
    content: &str,
    hash: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO note_revision (note_id, content, revision_hash) VALUES (?, ?, ?)",
    )
    .bind(note_id)
    .bind(content)
    .bind(hash)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// 该笔记最新一条版本的哈希，用来去重；没有版本时为 `None`。
pub async fn latest_revision_hash(
    conn: &mut SqliteConnection,
    note_id: i64,
) -> AppResult<Option<String>> {
    let hash = sqlx::query_scalar::<_, String>(
        "SELECT revision_hash FROM note_revision WHERE note_id = ? \
         ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(note_id)
    .fetch_optional(&mut *conn)
    .await?;

    Ok(hash)
}

/// 只留最近 `keep` 条，多出来的按时间从旧到新删。
///
/// 不设上限的话，一个开了自动保存的工作区一天就能攒下几千条全文副本。
pub async fn prune_revisions(
    conn: &mut SqliteConnection,
    note_id: i64,
    keep: i64,
) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM note_revision WHERE note_id = ? AND id NOT IN (\
           SELECT id FROM note_revision WHERE note_id = ? \
           ORDER BY created_at DESC, id DESC LIMIT ?\
         )",
    )
    .bind(note_id)
    .bind(note_id)
    .bind(keep)
    .execute(&mut *conn)
    .await?;

    Ok(())
}

/// 一篇笔记的历史版本，新的在前。
pub async fn list_revisions(pool: &SqlitePool, note_id: i64) -> AppResult<Vec<NoteRevision>> {
    let rows = sqlx::query_as::<_, RevisionRow>(
        "SELECT id, note_id, created_at, length(content) AS size, \
                substr(content, 1, 200) AS head \
         FROM note_revision WHERE note_id = ? \
         ORDER BY created_at DESC, id DESC",
    )
    .bind(note_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(RevisionRow::into_revision).collect())
}

/// 取一条版本，连正文一起。
pub async fn fetch_revision(pool: &SqlitePool, id: i64) -> AppResult<NoteRevisionDetail> {
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, String, String)>(
        "SELECT id, note_id, created_at, length(content), substr(content, 1, 200), content \
         FROM note_revision WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Message(format!("历史版本不存在：{id}")))?;

    let (id, note_id, created_at, size, head, content) = row;
    Ok(NoteRevisionDetail {
        revision: NoteRevision {
            id,
            note_id,
            created_at,
            size,
            preview: preview_of(&head),
        },
        content,
    })
}
