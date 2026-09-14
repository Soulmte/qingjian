use std::path::Path;
use std::time::Duration;

use sqlx::migrate::{MigrateError, Migrator};
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
    open_with(app_data_dir, &MIGRATOR).await
}

/// 打开连接池并跑一遍迁移。迁移集由调用方给，因为「库比程序新」那一次要用一套
/// 宽松的（见 `open_ignoring_extra_migrations`）。
async fn open_with(app_data_dir: &Path, migrator: &Migrator) -> AppResult<SqlitePool> {
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

    if let Err(error) = migrator.run(&pool).await {
        // 先把连接关干净再报错：调用方接下来会把坏掉的库改名挪走。池的析构是
        // 后台异步做的，等不到它，而 `quarantine` 里那个改名的重试就是为这一
        // 类残留句柄准备的。不关的直接后果是改名撞上「另一个程序正在使用此文
        // 件」（os error 32）——占用它的正是自己，0.1.8 就是这么起不来的。
        pool.close().await;
        return Err(error.into());
    }

    Ok(pool)
}

/// Opens the database, opening a newer one as-is and moving a broken one aside.
///
/// A failed migration or a corrupt file used to propagate out of `setup`, and
/// because Tauri aborts the whole app on a `setup` error the window never
/// appeared — indistinguishable from a crash. The note index is derived data
/// (the notes themselves are plain `.md` files on disk), so the honest recovery
/// is to set the broken database aside and rebuild it, then say so.
///
/// The one failure that is *not* corruption is a database written by a newer
/// build: it is opened as-is (see `open_ignoring_extra_migrations`), because
/// quarantining it would throw away settings and workspaces that cannot be
/// rebuilt from `.md` files.
///
/// Returns the message the UI should show, or `None` when nothing went wrong.
pub async fn init_pool_or_recover(
    app_data_dir: &Path,
) -> AppResult<(SqlitePool, Option<String>)> {
    match init_pool(app_data_dir).await {
        Ok(pool) => Ok((pool, None)),

        // 库里有一条迁移是当前程序不认识的：这不是坏库，是这个程序比库旧。把它
        // 搬走等于把设置、工作区、笔记索引一起丢掉——那三样都不在 .md 里，重建
        // 不回来。所以放行：按老的那一套打开，多出来的表和列放着不用，同时叫
        // 用户更新。
        Err(AppError::Migration(MigrateError::VersionMissing(version))) => {
            let pool = open_ignoring_extra_migrations(app_data_dir).await?;
            Ok((
                pool,
                Some(format!(
                    "这个数据库是更新版本的青简建的，当前这个青简比它旧（差着迁移 {version}）。\n\n\
                     为了不丢掉设置和工作区，已按旧的那一套把它打开，笔记都在。\
                     只是拿旧版本去写新库终究不是常事，建议尽快更新到最新版。"
                )),
            ))
        }

        Err(first) => {
            // 搬不走就说清楚是搬不走。光报一句「另一个程序正在使用此文件」会让人
            // 以为是自己开着青简，其实是改名这一步挡住的，而挡住的原因在 `first`
            // 里——那句话不能丢。
            let backup = quarantine(app_data_dir).map_err(|problem| {
                AppError::Message(format!(
                    "数据库无法打开（{first}）；想把它挪到一边留个备份时也失败了（{problem}）。"
                ))
            })?;

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

/// 容忍「库里有当前程序不认识的迁移」再开一次。
///
/// sqlx 默认会因此直接拒绝启动（`MigrateError::VersionMissing`），它防的是「老程序把
/// 新库写坏」。可青简的库是 .md 的索引加一点设置，把整库搬走的代价远大于按老一套打
/// 开：新版本加的表和列当前版本根本不会去读。认识的那几条仍然逐条比校验和，宽松的
/// 只是「多出来的那些」。
async fn open_ignoring_extra_migrations(app_data_dir: &Path) -> AppResult<SqlitePool> {
    // 不能直接改 MIGRATOR：它是 static，而 sqlx 也没给 Migrator 实现 Clone。
    // `migrate!` 展开出来的是一个常量表达式，在局部再取一份就行。
    let mut migrator: Migrator = sqlx::migrate!("./migrations");
    migrator.set_ignore_missing(true);
    open_with(app_data_dir, &migrator).await
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

    /// 库比程序新的时候（被更新版本的青简迁过），不能把库搬走：设置、工作区、
    /// 笔记索引都不在 .md 里，重建不回来。以前这种情况会一路炸到启动失败——用户
    /// 看到的是「另一个程序正在使用此文件」，其实占用它的是青简自己。
    #[tokio::test]
    async fn database_from_a_newer_build_is_opened_not_quarantined() {
        let dir = std::env::temp_dir().join(format!(
            "qingjian-db-newer-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        // 先建一个正常的库，再冒充「被更新的版本迁过」：塞一条当前程序不认识的迁移。
        let (pool, notice) = init_pool_or_recover(&dir).await.expect("first open");
        assert!(notice.is_none(), "clean start has nothing to report");
        pool.close().await;

        let pool = init_pool(&dir).await.expect("reopen");
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(9999_i64)
        .bind("a migration from a newer build")
        .bind(true)
        .bind(vec![0_u8; 48])
        .bind(0_i64)
        .execute(&pool)
        .await
        .expect("plant a migration this build does not know");
        pool.close().await;

        // 严格那一套会拒绝启动——这正是要接住的错。
        assert!(
            matches!(init_pool(&dir).await, Err(AppError::Migration(_))),
            "a newer database must make the strict migrator refuse"
        );

        let (pool, notice) = init_pool_or_recover(&dir)
            .await
            .expect("a newer database must still open");
        let notice = notice.expect("opening a newer database has to be reported");
        assert!(
            notice.contains("9999"),
            "the notice should name the migration: {notice}"
        );

        // 库没被动过：没被搬走，schema 也还在。
        let quarantined = std::fs::read_dir(&dir)
            .expect("list dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
            .count();
        assert_eq!(quarantined, 0, "a newer database must not be quarantined");

        let tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'note'",
        )
        .fetch_one(&pool)
        .await
        .expect("the database is still usable");
        assert_eq!(tables, 1, "the schema survived");

        drop(pool);
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
