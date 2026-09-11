use serde_json::{Map, Value};
use sqlx::Row;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Returns every stored setting as a single object so the frontend can hydrate
/// its settings store in one round trip.
#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> AppResult<Map<String, Value>> {
    let rows = sqlx::query("SELECT key, value FROM setting")
        .fetch_all(&state.pool)
        .await?;

    let mut settings = Map::with_capacity(rows.len());
    for row in rows {
        let key: String = row.get("key");
        let raw: String = row.get("value");
        // A corrupt value should not break the whole settings screen.
        let value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        settings.insert(key, value);
    }

    Ok(settings)
}

/// Stores `value` under `key`, replacing any previous value. Values are JSON so
/// a setting can be a string, number, boolean, object, or array.
#[tauri::command]
pub async fn set_setting(state: State<'_, AppState>, key: String, value: Value) -> AppResult<()> {
    let raw =
        serde_json::to_string(&value).map_err(|err| AppError::Message(err.to_string()))?;

    sqlx::query(
        "INSERT INTO setting (key, value, updated_at) VALUES (?, ?, unixepoch()) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()",
    )
    .bind(&key)
    .bind(raw)
    .execute(&state.pool)
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn delete_setting(state: State<'_, AppState>, key: String) -> AppResult<()> {
    sqlx::query("DELETE FROM setting WHERE key = ?")
        .bind(&key)
        .execute(&state.pool)
        .await?;

    Ok(())
}
