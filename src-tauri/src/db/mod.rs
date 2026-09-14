use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};

use crate::error::{AppError, AppResult};

/// File name of the SQLite database kept inside the app data directory.
pub const DB_FILE: &str = "qingjian.db";

/// Embedded migrations. Adding a file to `src-tauri/migrations` is enough for
/// it to be picked up.
///
/// # Do not edit a migration that has already run
///
/// sqlx stores a SHA-384 checksum per migration and refuses to start when a
/// previously applied file changes:
///
/// ```text
/// migration 1 was previously applied but has been modified
/// ```
///
/// The hash covers the whole file, comments included. This bit us once by
/// renaming the product name in a comment: the app then panicked during setup
/// and showed no window at all, which looks like a crash rather than a schema
/// error. Schema changes belong in a new, higher-numbered file.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Opens (creating if needed) the SQLite database and brings the schema up to
/// date. WAL keeps reads from blocking writes, which matters because note
/// snapshots and searches run while the editor autosaves.
pub async fn init_pool(app_data_dir: &Path) -> AppResult<SqlitePool> {
    std::fs::create_dir_all(app_data_dir)?;

    let options = SqliteConnectOptions::new()
        .filename(app_data_dir.join(DB_FILE))
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    if let Err(error) = MIGRATOR.run(&pool).await {
        // 先把连接关干净再报错：调用方接下来会把坏掉的库改名挪走。池的析构是
        // 后台异步做的，等不到它，而`quarantine` 里那个改名的重试就是为这一
        // 类残留句柄准备的。
        pool.close().await;
        return Err(error.into());
    }

    Ok(pool)
}

/// Opens the database, moving a database sqlx cannot open aside and retrying
/// once, returning a message describing what happened.
///
/// A failed migration or a corrupt file used to propagate out of `setup`, and
/// because Tauri aborts the whole app on a `setup` error the window never
/// appeared — indistinguishable from a crash. The note index is derived data
/// (the notes themselves are plain `.md` files on disk), so the honest recovery
/// is to set the broken database aside and rebuild it, then say so.
///
/// Returns the message the UI should show, or `None` when nothing went wrong.
pub async fn init_pool_or_recover(
    app_data_dir: &Path,
) -> AppResult<(SqlitePool, Option<String>)> {
    match init_pool(app_data_dir).await {
        Ok(pool) => Ok((pool, None)),
        Err(first) => {
            let backup = quarantine(app_data_dir)?;
            let pool = init_pool(app_data_dir).await.map_err(|second| {
                AppError::Message(format!(
                    "数据库无法打开：{first}。重建索引时再次失败：{second}"
                ))
            })?;

            Ok((
                pool,
                Some(format!(
                    "原有的数据库无法打开（{first}），已重建空索引并从磁盘重新扫描笔记。\n\n旧的数据库已备份到：{}",
                    backup.display()
                )),
            ))
        }
    }
}

/// Moves the database file (and its WAL companions) out of the way.
fn quarantine(app_data_dir: &Path) -> AppResult<std::path::PathBuf> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();

    let backup = app_data_dir.join(format!("{DB_FILE}.corrupt-{stamp}"));

    // The `-wal` and `-shm` files belong to the same database; leaving them
    // behind would reintroduce the inconsistency on the next attempt.
    for suffix in ["", "-wal", "-shm"] {
        let from = app_data_dir.join(format!("{DB_FILE}{suffix}"));
        if !from.exists() {
            continue;
        }
        let to = app_data_dir.join(format!("{DB_FILE}.corrupt-{stamp}{suffix}"));
        rename_with_retry(&from, &to)?;
    }

    Ok(backup)
}

/// 改名，碰上一时的占用就再试几次。
///
/// Windows 上这个改名是**偶发**失败的，报 `os error 32`（另一个程序正在使用此
/// 文件）：连接可能刚刚关闭、杀毒软件可能正在扫刚写下的文件、索引器也可能正好
/// 在碰它。而这里等的只是一个瞬间。
///
/// 不能只试一次：改名失败意味着恢复失败，而恢复失败意味着应用起不来——用户
/// 看到的是一句「无法打开工作区数据库」，而其实再过半秒就好了。等一会儿的
/// 上限是 375ms，比起「打不开」完全值得。
fn rename_with_retry(from: &Path, to: &Path) -> AppResult<()> {
    let mut last: Option<std::io::Error> = None;

    for attempt in 0..6 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) => last = Some(error),
        }
        std::thread::sleep(Duration::from_millis(25 * (attempt + 1)));
    }

    Err(last.expect("循环至少跑过一次").into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search;
    use sqlx::Row;

    async fn in_memory_pool() -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .in_memory(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("open in-memory database");
        MIGRATOR.run(&pool).await.expect("run migrations");
        pool
    }

    /// A database sqlx cannot open must not take the window with it. The index
    /// is derived data, so the recovery is to set the broken file aside and
    /// rebuild — and to report what happened.
    #[tokio::test]
    async fn unopenable_database_is_quarantined_and_rebuilt() {
        let dir = std::env::temp_dir().join(format!(
            "qingjian-db-recover-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        // A file that is definitively not a SQLite database.
        let broken = dir.join(DB_FILE);
        std::fs::write(&broken, b"this is not a database").expect("seed broken db");

        let (pool, notice) = init_pool_or_recover(&dir)
            .await
            .expect("recovery should succeed");

        let notice = notice.expect("a rebuild has to be reported");
        assert!(notice.contains("重建"), "unhelpful notice: {notice}");

        // The rebuilt database is usable and the schema is in place.
        let tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'note'",
        )
        .fetch_one(&pool)
        .await
        .expect("rebuilt database is queryable");
        assert_eq!(tables, 1, "rebuilt database is missing the schema");

        // The original was moved aside rather than deleted.
        let quarantined = std::fs::read_dir(&dir)
            .expect("list dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("corrupt-"))
            .count();
        assert_eq!(quarantined, 1, "expected exactly one quarantined file");

        drop(pool);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A healthy database must be opened as-is: quarantining one that is fine
    /// would silently throw away the user's index on every launch.
    #[tokio::test]
    async fn healthy_database_is_not_quarantined() {
        let dir = std::env::temp_dir().join(format!(
            "qingjian-db-healthy-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        let (first, notice) = init_pool_or_recover(&dir).await.expect("first open");
        assert!(notice.is_none(), "nothing to report on a clean start");
        drop(first);

        let (second, notice) = init_pool_or_recover(&dir).await.expect("reopen");
        assert!(notice.is_none(), "a healthy database must not be rebuilt");
        drop(second);

        let quarantined = std::fs::read_dir(&dir)
            .expect("list dir")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupt-"));
        assert!(!quarantined, "a healthy database was quarantined");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn migration_creates_expected_schema() {
        let pool = in_memory_pool().await;

        let tables: Vec<String> = sqlx::query(
            "SELECT name FROM sqlite_master \
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("inspect schema")
        .into_iter()
        .map(|row| row.get::<String, _>("name"))
        .collect();

        for expected in ["note", "note_fts", "secret", "setting", "workspace"] {
            assert!(
                tables.iter().any(|name| name == expected),
                "missing table `{expected}`, found: {tables:?}"
            );
        }

        // These were created by the first migration but never written to, so a
        // later migration drops them. They must not come back: an empty table
        // that nothing reads is a standing invitation to promise a feature that
        // does not exist.
        for dropped in ["note_history", "note_tag", "tag"] {
            assert!(
                !tables.iter().any(|name| name == dropped),
                "`{dropped}` should have been dropped, found: {tables:?}"
            );
        }
    }

    /// FTS5's `unicode61` tokenizer cannot split Chinese, so the index stores
    /// CJK text split per character (see `crate::search`). This test locks in
    /// that the round trip actually finds a Chinese substring.
    #[tokio::test]
    async fn fts_finds_chinese_substring_after_indexing() {
        let pool = in_memory_pool().await;

        let content = search::to_index_text("所有权与借用检查器");
        sqlx::query("INSERT INTO note_fts (note_id, title, content, rel_path) VALUES (?, ?, ?, ?)")
            .bind(1_i64)
            .bind(search::to_index_text("Rust 并发"))
            .bind(&content)
            .bind("rust/concurrency.md")
            .execute(&pool)
            .await
            .expect("insert into fts index");

        let hits: i64 = sqlx::query_scalar("SELECT count(*) FROM note_fts WHERE note_fts MATCH ?")
            .bind(search::to_match_query("借用").expect("query is searchable"))
            .fetch_one(&pool)
            .await
            .expect("query fts index");
        assert_eq!(hits, 1, "Chinese substring search should match");

        let misses: i64 = sqlx::query_scalar("SELECT count(*) FROM note_fts WHERE note_fts MATCH ?")
            .bind(search::to_match_query("借检").expect("query is searchable"))
            .fetch_one(&pool)
            .await
            .expect("query fts index");
        assert_eq!(misses, 0, "non-adjacent characters must not match");
    }
}
