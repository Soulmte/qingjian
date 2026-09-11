use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Serialize;

/// One font family installed on the machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    /// True when the family is fixed-width, which is what the code font list
    /// is filtered on.
    pub monospace: bool,
}

/// Scanning the font directories costs real time, so the result is cached for
/// the lifetime of the process.
static SYSTEM_FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();

/// Collapses raw `(family, monospace)` pairs into one sorted entry per family.
/// A family counts as monospace if any of its faces is.
fn merge_families(entries: impl Iterator<Item = (String, bool)>) -> Vec<SystemFont> {
    let mut merged: BTreeMap<String, bool> = BTreeMap::new();

    for (family, monospace) in entries {
        let family = family.trim().to_string();
        // Generic aliases such as `sans-serif` are not real font names.
        if family.is_empty() || family.starts_with('.') {
            continue;
        }
        let slot = merged.entry(family).or_insert(false);
        *slot = *slot || monospace;
    }

    merged
        .into_iter()
        .map(|(family, monospace)| SystemFont { family, monospace })
        .collect()
}

fn scan_system_fonts() -> Vec<SystemFont> {
    use fontdb::Database;

    let mut db = Database::new();
    db.load_system_fonts();

    // Collected eagerly so the borrow of `db` does not outlive this scope.
    let mut entries: Vec<(String, bool)> = Vec::new();
    for face in db.faces() {
        for (name, _language) in &face.families {
            entries.push((name.clone(), face.monospaced));
        }
    }

    merge_families(entries.into_iter())
}

/// Font families available on this machine, sorted by name.
pub fn list_system_fonts_impl() -> Vec<SystemFont> {
    SYSTEM_FONTS.get_or_init(scan_system_fonts).clone()
}

#[tauri::command]
pub async fn list_system_fonts() -> Vec<SystemFont> {
    list_system_fonts_impl()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn families_are_deduplicated_and_sorted() {
        let merged = merge_families(
            [
                ("Noto Sans".to_string(), false),
                ("Cascadia Code".to_string(), true),
                ("Noto Sans".to_string(), false),
                ("   ".to_string(), false),
                (".hidden".to_string(), false),
                ("Noto Sans Mono".to_string(), true),
            ]
            .into_iter(),
        );

        let names: Vec<&str> = merged.iter().map(|font| font.family.as_str()).collect();
        assert_eq!(names, vec!["Cascadia Code", "Noto Sans", "Noto Sans Mono"]);
    }

    #[test]
    fn monospace_flag_is_kept_when_any_face_is_fixed_width() {
        let merged = merge_families(
            [
                ("Dup".to_string(), false),
                ("Dup".to_string(), true),
            ]
            .into_iter(),
        );

        assert_eq!(merged.len(), 1);
        assert!(merged[0].monospace);
    }

    /// The scan itself depends on the host, so this only checks that it is
    /// usable and stable rather than asserting particular fonts exist.
    #[test]
    fn system_scan_is_sorted_and_repeatable() {
        let first = list_system_fonts_impl();
        let second = list_system_fonts_impl();

        assert_eq!(first.len(), second.len(), "cached scan should be stable");
        assert!(
            first.windows(2).all(|pair| pair[0].family <= pair[1].family),
            "families should come back sorted"
        );
    }
}
