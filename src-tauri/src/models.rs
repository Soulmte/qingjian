use serde::{Deserialize, Serialize};

/// A folder on disk that the user opened as a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub last_opened_at: Option<i64>,
}

/// Metadata for one Markdown file. The document body always lives on disk; only
/// this row is stored in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub workspace_id: i64,
    pub rel_path: String,
    pub title: String,
    pub content_hash: Option<String>,
    pub pinned: bool,
    pub is_deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A note together with the contents read from disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    pub note: Note,
    pub content: String,
    /// [`services::hash_content`] of the content that was just read.
    ///
    /// The caller keeps it as the baseline for the next save: it is what "the
    /// version I have" means, so a file that changed on disk in the meantime can
    /// be told apart from one that did not.
    pub hash: String,
}

/// What a save did.
///
/// A conflict is not an error: nothing was written, and the caller decides
/// whether to reload the file or to overwrite it deliberately.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved {
        note: Note,
        /// The hash of the file as it now is, which the caller keeps as the
        /// baseline for the next save.
        hash: String,
    },
    /// The file on disk is no longer the version that was read.
    Conflict {
        // Spelled out because `rename_all` on the enum renames the variants, not
        // the fields inside them — and the frontend reads this one by name.
        #[serde(rename = "diskHash")]
        disk_hash: String,
    },
}

/// One full-text search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub note_id: i64,
    pub workspace_id: i64,
    pub title: String,
    pub rel_path: String,
    pub snippet: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note() -> Note {
        Note {
            id: 1,
            workspace_id: 2,
            rel_path: "笔记/甲.md".into(),
            title: "甲".into(),
            content_hash: None,
            pinned: false,
            is_deleted: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    /// The frontend reads these payloads by field name, so the names are a
    /// contract. `rename_all` on the enum only renames its variants, which makes
    /// a field easy to get wrong — and a wrong name is invisible on both sides
    /// until the moment it matters.
    #[test]
    fn save_outcomes_use_the_field_names_the_frontend_reads() {
        let json = serde_json::to_string(&SaveOutcome::Saved {
            note: note(),
            hash: "abc".into(),
        })
        .expect("serialise");

        assert!(json.contains(r#""status":"saved""#), "{json}");
        assert!(json.contains(r#""hash":"abc""#), "{json}");
        assert!(json.contains(r#""relPath":"笔记/甲.md""#), "{json}");

        let json = serde_json::to_string(&SaveOutcome::Conflict {
            disk_hash: "def".into(),
        })
        .expect("serialise");

        assert!(json.contains(r#""status":"conflict""#), "{json}");
        assert!(json.contains(r#""diskHash":"def""#), "{json}");
    }
}
