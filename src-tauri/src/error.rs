use serde::Serialize;

/// Error type shared by every Tauri command. It serialises to a plain string so
/// the frontend receives a readable message instead of a structured payload it
/// would have to unwrap.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Database(#[from] sqlx::Error),

    #[error("数据库迁移失败：{0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Message(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
