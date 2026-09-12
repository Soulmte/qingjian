use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

/// Extensions treated as editable Markdown documents.
const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// Guards against pathological trees and symlink loops.
const MAX_SCAN_DEPTH: usize = 32;

/// Folder names that only ever hold build output or dependency caches.
///
/// Opening a project folder as a workspace used to walk the whole tree, and
/// `node_modules` alone ships a README for every one of its tens of thousands of
/// packages — so the sidebar filled with other people's docs and the app stalled.
/// These folders are skipped outright; the names are those of generated output
/// and never of a place someone keeps their notes. (Hidden folders such as `.git`
/// or `.venv` are already skipped by the leading-dot rule.)
const SKIP_DIRS: [&str; 13] = [
    "node_modules",
    "bower_components",
    "jspm_packages",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "vendor",
    "Pods",
    "DerivedData",
    "__pycache__",
    "site-packages",
];

/// Whether a directory name is one of the generated folders we never descend
/// into. Case-insensitive because Windows folder names are.
fn is_skipped_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip))
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            MARKDOWN_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

/// Joins a workspace-relative path onto `root`, rejecting anything that would
/// escape the workspace. Every path coming from the frontend goes through here,
/// so a crafted `rel_path` cannot read or overwrite files elsewhere on disk.
pub fn resolve_within(root: &Path, rel_path: &str) -> AppResult<PathBuf> {
    let candidate = Path::new(rel_path);

    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(AppError::Message(format!(
                    "非法的相对路径：{rel_path}"
                )))
            }
        }
    }

    let joined = root.join(candidate);

    // The final component may not exist yet (new note), so compare the deepest
    // existing ancestor instead of canonicalising the whole path.
    let mut existing = joined.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| AppError::Message(format!("无法解析路径：{rel_path}")))?;
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|_| AppError::Message(format!("工作区目录不存在：{}", root.display())))?;
    let canonical_existing = existing
        .canonicalize()
        .map_err(|_| AppError::Message(format!("路径不存在：{}", existing.display())))?;

    if !canonical_existing.starts_with(&canonical_root) {
        return Err(AppError::Message(format!(
            "路径越界，已拒绝访问工作区之外的文件：{rel_path}"
        )));
    }

    Ok(joined)
}

/// Writes `contents` through a temporary file in the same directory, then
/// renames it into place. A crash mid-write therefore never truncates the
/// user's document.
pub fn atomic_write(path: &Path, contents: &str) -> AppResult<()> {
    atomic_write_bytes(path, contents.as_bytes())
}

/// Byte-oriented counterpart of [`atomic_write`], used for pasted images.
pub fn atomic_write_bytes(path: &Path, contents: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message(format!("无效的文件路径：{}", path.display())))?;
    std::fs::create_dir_all(parent)?;

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let tmp = parent.join(format!(".qingjian-{}-{unique}.tmp", std::process::id()));

    std::fs::write(&tmp, contents)?;
    if let Err(err) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err.into());
    }

    Ok(())
}

pub fn read_text(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Err(AppError::Message(format!(
            "文件不存在：{}",
            path.display()
        )));
    }
    Ok(decode_text(&std::fs::read(path)?))
}

/// The identity of a file's contents, for telling "this is the version I read"
/// from "somebody else has written it since".
///
/// The text is decoded exactly as `read_text` decodes it and hashed with the same
/// function a save uses on the editor buffer. Line endings are normalised first:
/// the editor works in LF, so a CRLF document would otherwise hash differently
/// from the same text in the buffer and every single save would look like a
/// conflict.
pub fn hash_file(path: &Path) -> AppResult<String> {
    Ok(hash_content_lf(&read_text(path)?))
}

/// Moves a file to the recycle bin rather than unlinking it.
///
/// Deleting a note is the one destructive thing the app does, and a mis-click
/// should be recoverable. The shell's own delete is what puts a file in the bin
/// with its original path recorded, so that is what is asked for; a volume
/// without a bin (a network share, a removable drive) makes the shell refuse,
/// and there the honest fallback is a plain delete — which is what the caller
/// has always done.
pub fn delete_file(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    if let Err(error) = shell_delete(path) {
        // Not fatal on its own: the caller's fallback is the old behaviour.
        eprintln!("无法移入回收站，将直接删除：{error}");
    } else {
        return Ok(());
    }

    std::fs::remove_file(path)?;
    Ok(())
}

/// The directory counterpart of [`delete_file`].
///
/// The shell's delete works on a directory too (and is what puts the whole tree
/// in the recycle bin with its path recorded). The fallback differs, though: a
/// plain `remove_file` cannot remove a directory, so the un-recyclable case — a
/// network share, a removable drive — removes the tree outright.
pub fn delete_directory(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    if let Err(error) = shell_delete(path) {
        eprintln!("无法移入回收站，将直接删除：{error}");
    } else {
        return Ok(());
    }

    std::fs::remove_dir_all(path)?;
    Ok(())
}

/// The shell's delete, which is the only way to reach the recycle bin.
#[cfg(windows)]
fn shell_delete(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, SHFILEOPSTRUCTW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI,
        FOF_SILENT, FO_DELETE,
    };

    // The list is double-null terminated; that is how the API finds its end.
    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.extend([0, 0]);

    let mut operation = SHFILEOPSTRUCTW {
        hwnd: HWND(std::ptr::null_mut()),
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        pTo: PCWSTR::null(),
        // No confirmation and no dialog: the app has already asked. The struct
        // field is the raw `u16`, while the flags themselves are a newtype.
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI).0 as u16,
        fAnyOperationsAborted: Default::default(),
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: PCWSTR::null(),
    };

    let code = unsafe { SHFileOperationW(&mut operation) };
    if code != 0 {
        return Err(format!("Shell 返回 {code}"));
    }
    if operation.fAnyOperationsAborted.as_bool() {
        return Err("操作被取消".to_string());
    }
    Ok(())
}

/// Byte-order marks, which are metadata rather than content and would otherwise
/// surface as a stray character at the top of the document.
const UTF8_BOM: &[u8] = &[0xef, 0xbb, 0xbf];
const UTF16LE_BOM: &[u8] = &[0xff, 0xfe];
const UTF16BE_BOM: &[u8] = &[0xfe, 0xff];

/// Decodes a document that may not be UTF-8.
///
/// UTF-8 is the common case and is tried first. Anything that fails is read as
/// GB18030 — the default of Chinese Windows editors, and the encoding most
/// likely to reach a Chinese-language editor. Refusing those files outright
/// would mean the app could not open the documents it is most likely to meet.
/// The BOM is dropped either way, so it never becomes part of the first line.
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(body) = bytes.strip_prefix(UTF8_BOM) {
        return String::from_utf8_lossy(body).into_owned();
    }
    if let Some(body) = bytes.strip_prefix(UTF16LE_BOM) {
        return encoding_rs::UTF_16LE.decode(body).0.into_owned();
    }
    if let Some(body) = bytes.strip_prefix(UTF16BE_BOM) {
        return encoding_rs::UTF_16BE.decode(body).0.into_owned();
    }

    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::GB18030.decode(bytes).0.into_owned(),
    }
}

/// The two line endings a Markdown file is written with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// Guesses the dominant ending of an existing file.
///
/// A CRLF file contains exactly one `\n` per `\r\n`, so equal counts mean every
/// line break is a Windows one; anything else (mixed, or plain `\n`) is left as
/// LF rather than guessed at.
pub fn detect_line_ending(bytes: &[u8]) -> LineEnding {
    let crlf = bytes.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = bytes.iter().filter(|byte| **byte == b'\n').count();

    if crlf > 0 && crlf == lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

/// Rewrites `contents` to the requested ending.
///
/// The editor always produces LF, so a file that arrived with CRLF has to be
/// converted back on the way out — otherwise editing one line would re-write
/// every line break in the file and turn a small change into a whole-file diff.
pub fn apply_line_ending(contents: &str, ending: LineEnding) -> String {
    match ending {
        LineEnding::Lf => contents.to_string(),
        LineEnding::Crlf => contents.replace("\r\n", "\n").replace('\n', "\r\n"),
    }
}

/// Lists every Markdown file under `root` as a forward-slash relative path,
/// sorted so the sidebar order is stable across runs. Hidden entries are
/// skipped, which also keeps `.git` and `.obsidian` out of the tree.
pub fn scan_markdown(root: &Path) -> AppResult<Vec<String>> {
    if !root.is_dir() {
        return Err(AppError::Message(format!(
            "工作区目录不存在：{}",
            root.display()
        )));
    }

    let mut files = Vec::new();
    collect(root, root, 0, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) -> AppResult<()> {
    if depth > MAX_SCAN_DEPTH {
        return Ok(());
    }

    // One unreadable folder (permissions, a stale mount, a file that vanished mid
    // walk) must not abort the whole scan: skipping it still returns every note
    // that could be read, which is far better than an error and an empty tree.
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();

        if file_type.is_dir() {
            if is_skipped_dir(&name) {
                continue;
            }
            collect(root, &path, depth + 1, out)?;
        } else if file_type.is_file() && is_markdown(&path) {
            if let Ok(relative) = path.strip_prefix(root) {
                out.push(to_slash_path(relative));
            }
        }
    }

    Ok(())
}

/// Lists every subdirectory under `root` as a forward-slash relative path.
///
/// The sidebar tree is built from notes, so a folder the user just created would
/// be invisible until something was put inside it. Returning the directories too
/// is what lets an empty folder show up, and what makes a folder's own context
/// menu reachable.
///
/// Pruning matches [`scan_markdown`]: hidden entries and generated folders are
/// skipped, so the tree does not grow `node_modules` back into existence.
pub fn scan_directories(root: &Path) -> AppResult<Vec<String>> {
    if !root.is_dir() {
        return Err(AppError::Message(format!(
            "工作区目录不存在：{}",
            root.display()
        )));
    }

    let mut dirs = Vec::new();
    collect_directories(root, root, 0, &mut dirs)?;
    dirs.sort();
    Ok(dirs)
}

fn collect_directories(
    root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<String>,
) -> AppResult<()> {
    if depth > MAX_SCAN_DEPTH {
        return Ok(());
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || is_skipped_dir(&name) {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let path = entry.path();
        if let Ok(relative) = path.strip_prefix(root) {
            out.push(to_slash_path(relative));
        }
        collect_directories(root, &path, depth + 1, out)?;
    }

    Ok(())
}

pub fn to_slash_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Title shown in the sidebar before the file has been parsed: the file stem.
pub fn title_from_path(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(rel_path)
        .to_string()
}

/// Normalises a user-supplied path into a workspace-relative Markdown path:
/// forward slashes, no leading slash, and a `.md` extension. Path traversal is
/// still rejected later by [`resolve_within`].
pub fn normalize_markdown_path(input: &str) -> String {
    let mut rel = input.trim().replace('\\', "/");
    while let Some(stripped) = rel.strip_prefix('/') {
        rel = stripped.to_string();
    }
    while rel.contains("//") {
        rel = rel.replace("//", "/");
    }

    let lower = rel.to_ascii_lowercase();
    if !lower.ends_with(".md") && !lower.ends_with(".markdown") {
        rel.push_str(".md");
    }

    rel
}

/// Derives a note title from its contents: the `title` key of a leading YAML
/// block, otherwise the first ATX heading, otherwise the first non-empty line,
/// otherwise the file name.
///
/// The block has to be recognised here as well as in the editor — without it the
/// note's name would be the first line of its metadata, `---`.
pub fn extract_title(content: &str, fallback: &str) -> String {
    let (metadata, body) = match split_front_matter(content) {
        Some((metadata, body)) => (metadata, body),
        None => (Vec::new(), content.lines().collect()),
    };

    if let Some(title) = metadata_value(&metadata, "title") {
        return title.chars().take(120).collect();
    }

    for line in body {
        let line = line.trim();
        if line.is_empty() || is_noise_line(line) {
            continue;
        }
        let heading = line.trim_start_matches('#').trim();
        let text = if heading.len() != line.len() { heading } else { line };
        let text = text.trim_matches('*').trim();
        if !text.is_empty() {
            return text.chars().take(120).collect();
        }
    }
    fallback.to_string()
}

/// A line that carries no words: a thematic break, a fence, or the alignment
/// marker the editor writes. Without this, a note that opens with a rule would
/// be named `---` in the sidebar.
fn is_noise_line(line: &str) -> bool {
    if line.starts_with("<!--") || line.starts_with("```") || line.starts_with("~~~") {
        return true;
    }
    line.chars()
        .all(|c| matches!(c, '-' | '*' | '_' | '=' | '>' | '#' | ' ' | '\t'))
}

/// The lines of a leading YAML block (delimiters included) and of the body.
///
/// The block has to be unbroken — opener on the first line, no blank line after
/// it, closer before the next blank line. Those conditions are what separate
/// metadata from two thematic breaks with text between them, which is what a
/// note containing `---`, a paragraph and `---` looks like.
fn split_front_matter(content: &str) -> Option<(Vec<&str>, Vec<&str>)> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.first()?.trim_end() != "---" {
        return None;
    }
    if lines.get(1)?.trim().is_empty() {
        return None;
    }

    let mut end = None;
    for (index, line) in lines.iter().enumerate().skip(1) {
        if line.trim().is_empty() {
            break;
        }
        if is_front_matter_delimiter(line) {
            end = Some(index);
            break;
        }
    }
    let end = end?;

    // Blank lines between the block and the first paragraph are separators.
    let body = lines[end + 1..]
        .iter()
        .position(|line| !line.trim().is_empty())
        .map(|offset| lines[end + 1 + offset..].to_vec())
        .unwrap_or_default();

    Some((lines[..=end].to_vec(), body))
}

fn is_front_matter_delimiter(line: &str) -> bool {
    let trimmed = line.trim_end();
    trimmed == "---" || trimmed == "..."
}

/// Reads a top-level scalar (`key: value`) out of the metadata block.
fn metadata_value(lines: &[&str], key: &str) -> Option<String> {
    for line in lines.iter().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let is_identifier = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !is_identifier || !name.eq_ignore_ascii_case(key) {
            continue;
        }

        let value = strip_quotes(value.trim());
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn strip_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() > 1 {
        let first = bytes[0];
        if (first == b'"' || first == b'\'') && bytes[bytes.len() - 1] == first {
            return value[1..value.len() - 1].trim();
        }
    }
    value
}

/// FNV-1a over the UTF-8 bytes. Deterministic across runs and platforms, so a
/// stored hash stays meaningful after a restart — unlike `DefaultHasher`.
pub fn hash_content(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// [`hash_content`] of the text with CRLF read as LF, computed without making a
/// line-ending-normalised copy of it.
///
/// `hash_file` used to `replace("\r\n", "\n")` the whole document first, which
/// allocated a second copy of every note just to hash it. Skipping the `\r` of a
/// `\r\n` on the fly produces the same hash without the copy, which matters on
/// the large documents where that copy was the visible cost.
pub fn hash_content_lf(content: &str) -> String {
    let bytes = content.as_bytes();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
            // Drop the CR half only; the LF is hashed on the next iteration.
            index += 1;
            continue;
        }
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        index += 1;
    }
    format!("{hash:016x}")
}

/// Normalises the folder (relative to the workspace) that pasted images go
/// into. Traversal is still rejected downstream by [`resolve_within`].
pub fn normalize_relative_dir(input: &str) -> String {
    input.trim().replace('\\', "/").trim_matches('/').to_string()
}

/// Reduces a proposed file name to a safe set of characters. Names come from
/// the frontend and, indirectly, from clipboard metadata, so they are never
/// trusted as-is.
pub fn sanitize_file_name(input: &str) -> String {
    let mut name: String = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();

    // Collapse `..` so no part can read as a parent directory. Stripping the
    // separators above already makes traversal impossible; this keeps the
    // resulting name from looking like an escape attempt.
    while name.contains("..") {
        name = name.replace("..", "-");
    }

    // A leading dot would create a hidden file that the scanner then ignores.
    let name = name.trim_start_matches('.').to_string();

    if !name.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        return "image".to_string();
    }

    name.chars().take(120).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_parent_traversal() {
        let root = std::env::temp_dir();
        assert!(resolve_within(&root, "../secrets.md").is_err());
        assert!(resolve_within(&root, "notes/../../etc/passwd").is_err());
        assert!(resolve_within(&root, "C:/windows/system32/x.md").is_err());
    }

    #[test]
    fn resolve_accepts_nested_paths() {
        let root = std::env::temp_dir();
        let resolved = resolve_within(&root, "notes/rust/ownership.md").expect("valid path");
        assert!(resolved.ends_with("notes/rust/ownership.md"));
    }

    #[test]
    fn title_prefers_first_heading() {
        assert_eq!(extract_title("# 所有权\n\n正文", "fallback"), "所有权");
        assert_eq!(extract_title("没有标题\n第二行", "fallback"), "没有标题");
        assert_eq!(extract_title("\n\n   \n", "fallback"), "fallback");
        assert_eq!(extract_title("", "笔记"), "笔记");
    }

    #[test]
    fn title_reads_the_metadata_block() {
        let note = "---\ntitle: 毕业论文\nauthor: lq\n---\n\n# 第一章\n";
        assert_eq!(extract_title(note, "fallback"), "毕业论文");

        // Without a `title` key the first heading still wins, not the metadata.
        let untitled = "---\nauthor: lq\n---\n\n# 第一章\n";
        assert_eq!(extract_title(untitled, "fallback"), "第一章");

        // Quotes are part of the syntax, not of the title.
        assert_eq!(
            extract_title("---\ntitle: \"带引号\"\n---\n\n正文", "fallback"),
            "带引号"
        );
    }

    #[test]
    fn two_rules_around_text_are_not_metadata() {
        // The shape a note with `---`, a paragraph and `---` has. Reading it as
        // metadata would swallow the heading and misname the note.
        let note = "---\n\n# 第一章\n\n---\n\n正文\n";
        assert_eq!(extract_title(note, "fallback"), "第一章");
    }

    #[test]
    fn an_unterminated_block_is_not_metadata() {
        // Nothing closes it, so it is a rule followed by a paragraph — and the
        // line the author wrote first is what names the note.
        let note = "---\ntitle: 没有结束\n\n正文\n";
        assert_eq!(extract_title(note, "fallback"), "title: 没有结束");
    }

    #[test]
    fn hash_is_stable_and_content_sensitive() {
        assert_eq!(hash_content("abc"), hash_content("abc"));
        assert_ne!(hash_content("abc"), hash_content("abd"));
    }

    #[test]
    fn hashing_normalises_line_endings_without_copying() {
        // Same hash as the old `replace("\r\n", "\n")` form, so stored hashes
        // stay valid — but computed in place.
        for text in ["a\nb\n", "# 标题\n\n正文\n", ""] {
            assert_eq!(hash_content_lf(text), hash_content(text));
        }
        assert_eq!(hash_content_lf("a\r\nb\r\n"), hash_content("a\nb\n"));
        // A lone CR is content, not an ending, and is left alone.
        assert_eq!(hash_content_lf("a\rb"), hash_content("a\rb"));
    }

    #[test]
    fn scan_skips_generated_folders_and_keeps_notes() {
        let root = std::env::temp_dir().join(format!("qingjian-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        // A note the user cares about, and the shape of a real project around it.
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/guide.md"), "# 指南\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/README.md"), "# 别人的文档\n").unwrap();
        std::fs::create_dir_all(root.join("target/debug")).unwrap();
        std::fs::write(root.join("target/debug/build.md"), "# 构建产物\n").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/notes.md"), "# 隐藏\n").unwrap();
        // A generated name nested deeper still has to be pruned.
        std::fs::create_dir_all(root.join("docs/dist")).unwrap();
        std::fs::write(root.join("docs/dist/built.md"), "# 输出\n").unwrap();

        let files = scan_markdown(&root).expect("scan");
        assert_eq!(files, vec!["docs/guide.md".to_string()]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_directories_lists_folders_and_skips_generated_ones() {
        let root = std::env::temp_dir().join(format!("qingjian-dirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        std::fs::create_dir_all(root.join("docs/guide")).unwrap();
        std::fs::write(root.join("docs/guide/a.md"), "# x\n").unwrap();
        // An empty folder has to show up too — that is the whole point.
        std::fs::create_dir_all(root.join("empty")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();

        let dirs = scan_directories(&root).expect("scan");
        assert_eq!(
            dirs,
            vec![
                "docs".to_string(),
                "docs/guide".to_string(),
                "empty".to_string()
            ]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn markdown_extension_matching_is_case_insensitive() {
        assert!(is_markdown(Path::new("a.md")));
        assert!(is_markdown(Path::new("a.MD")));
        assert!(is_markdown(Path::new("a.markdown")));
        assert!(!is_markdown(Path::new("a.txt")));
    }

    #[test]
    fn scan_listing_uses_forward_slashes() {
        assert_eq!(to_slash_path(Path::new("a/b/c.md")), "a/b/c.md");
    }

    #[test]
    fn normalize_path_adds_extension_and_unifies_separators() {
        assert_eq!(normalize_markdown_path("notes\\rust"), "notes/rust.md");
        assert_eq!(normalize_markdown_path("/a//b.md"), "a/b.md");
        assert_eq!(normalize_markdown_path("  b.MARKDOWN  "), "b.MARKDOWN");
    }

    #[test]
    fn file_names_are_stripped_to_safe_characters() {
        assert_eq!(sanitize_file_name("paste-17.png"), "paste-17.png");
        assert_eq!(sanitize_file_name("a b:c*d.png"), "a-b-c-d.png");
        assert_eq!(sanitize_file_name("..."), "image");
        assert_eq!(sanitize_file_name(""), "image");

        // Whatever comes in, the result must stay a single, visible file name.
        for candidate in ["../../etc/passwd", "..\\..\\win.ini", "/etc/hosts"] {
            let safe = sanitize_file_name(candidate);
            assert!(!safe.contains('/'), "separator survived: {safe}");
            assert!(!safe.contains('\\'), "separator survived: {safe}");
            assert!(!safe.starts_with('.'), "hidden name survived: {safe}");
            assert!(!safe.contains(".."), "traversal segment survived: {safe}");
        }
    }

    #[test]
    fn relative_dir_is_trimmed_to_slashes() {
        assert_eq!(normalize_relative_dir("/assets/"), "assets");
        assert_eq!(normalize_relative_dir("img\\pasted"), "img/pasted");
        assert_eq!(normalize_relative_dir("   "), "");
    }

    #[test]
    fn utf8_documents_are_read_as_they_are() {
        assert_eq!(decode_text("# 标题\n正文".as_bytes()), "# 标题\n正文");
    }

    #[test]
    fn a_byte_order_mark_is_dropped_rather_than_shown() {
        let with_bom = [UTF8_BOM, "# 标题".as_bytes()].concat();
        assert_eq!(decode_text(&with_bom), "# 标题");
    }

    #[test]
    fn a_gb18030_document_still_opens() {
        // 中文 Windows 编辑器写出的默认编码；按 UTF-8 解会直接失败。
        let (encoded, _, _) = encoding_rs::GB18030.encode("# 标题\n\n正文");
        assert!(std::str::from_utf8(&encoded).is_err(), "fixture should not be UTF-8");
        assert_eq!(decode_text(&encoded), "# 标题\n\n正文");
    }

    #[test]
    fn utf16_documents_are_decoded_from_their_mark() {
        // U+4F60 U+597D, little-endian, behind the mark a Windows editor writes.
        let bytes = [UTF16LE_BOM, &[0x60, 0x4f, 0x7d, 0x59][..]].concat();
        assert_eq!(decode_text(&bytes), "你好");
    }

    #[test]
    fn line_endings_are_detected_from_the_file() {
        assert_eq!(detect_line_ending(b"a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending(b"a\r\nb\r\n"), LineEnding::Crlf);
        // Mixed input is not guessed at.
        assert_eq!(detect_line_ending(b"a\r\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending(b""), LineEnding::Lf);
    }

    #[test]
    fn saving_restores_the_original_line_ending() {
        assert_eq!(apply_line_ending("a\nb", LineEnding::Lf), "a\nb");
        assert_eq!(apply_line_ending("a\nb", LineEnding::Crlf), "a\r\nb");
        // Running it twice must not double the carriage returns.
        assert_eq!(apply_line_ending("a\r\nb", LineEnding::Crlf), "a\r\nb");
    }
}
