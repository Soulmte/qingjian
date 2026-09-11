/// Whether `ch` is written without word separators and therefore needs
/// per-character indexing.
///
/// FTS5's built-in `unicode61` tokenizer only splits on punctuation and
/// whitespace, so a Chinese sentence becomes a single token and substring
/// queries never match. Splitting CJK per character and matching CJK runs as
/// FTS5 phrases restores substring semantics without a native tokenizer.
pub fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{3040}'..='\u{30FF}'     // hiragana + katakana
        | '\u{3400}'..='\u{4DBF}'   // CJK unified ideographs extension A
        | '\u{4E00}'..='\u{9FFF}'   // CJK unified ideographs
        | '\u{F900}'..='\u{FAFF}'   // CJK compatibility ideographs
        | '\u{20000}'..='\u{2FA1F}' // extensions B and beyond
    )
}

/// Transforms raw note text into the form stored in the FTS5 index: every CJK
/// character becomes its own token, everything else is kept as-is.
pub fn to_index_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for ch in text.chars() {
        if is_cjk(ch) {
            out.push(' ');
            out.push(ch);
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn flush_cjk(run: &mut String, clauses: &mut Vec<String>) {
    if run.is_empty() {
        return;
    }
    let phrase = run
        .chars()
        .map(|ch| ch.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    clauses.push(format!("\"{phrase}\""));
    run.clear();
}

fn flush_latin(buf: &mut String, clauses: &mut Vec<String>) {
    if buf.is_empty() {
        return;
    }
    clauses.push(format!("\"{}\"", buf.replace('"', "\"\"")));
    buf.clear();
}

/// Builds an FTS5 `MATCH` expression from a user query.
///
/// Latin words become quoted terms, CJK runs become quoted phrases of
/// single-character tokens so that `借用` only matches where the two
/// characters are adjacent. Returns `None` when the query holds no searchable
/// characters.
pub fn to_match_query(query: &str) -> Option<String> {
    let mut clauses: Vec<String> = Vec::new();
    let mut cjk_run = String::new();
    let mut latin = String::new();

    for ch in query.chars() {
        if is_cjk(ch) {
            flush_latin(&mut latin, &mut clauses);
            cjk_run.push(ch);
        } else if ch.is_alphanumeric() {
            flush_cjk(&mut cjk_run, &mut clauses);
            latin.push(ch);
        } else {
            flush_cjk(&mut cjk_run, &mut clauses);
            flush_latin(&mut latin, &mut clauses);
        }
    }
    flush_cjk(&mut cjk_run, &mut clauses);
    flush_latin(&mut latin, &mut clauses);

    if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" "))
    }
}

/// Produces a one-line excerpt around the first occurrence of `query` in
/// `raw`, so search results stay readable. The index stores CJK text split per
/// character, which is unreadable, so snippets are built from the raw copy
/// kept alongside it.
///
/// Lengths are counted in characters, not bytes, to avoid splitting a
/// multi-byte character in half.
pub fn make_snippet(raw: &str, query: &str, max_chars: usize) -> String {
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.is_empty() {
        return String::new();
    }

    let flat_chars: Vec<char> = flat.chars().collect();
    let needle: Vec<char> = query
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect();

    let start = find_subsequence(&flat_chars, &needle).unwrap_or(0);
    // Keep a little context in front of the match when possible.
    let from = start.saturating_sub(max_chars / 3);
    let to = (from + max_chars).min(flat_chars.len());

    let mut snippet = String::new();
    if from > 0 {
        snippet.push('…');
    }
    snippet.extend(&flat_chars[from..to]);
    if to < flat_chars.len() {
        snippet.push('…');
    }
    snippet
}

fn find_subsequence(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_text_splits_cjk_and_keeps_latin_words() {
        assert_eq!(to_index_text("所有权与借用"), "所 有 权 与 借 用");
        assert_eq!(to_index_text("Rust 所有权"), "Rust 所 有 权");
        assert_eq!(to_index_text("  spaced   out  "), "spaced out");
    }

    #[test]
    fn match_query_turns_cjk_into_phrases() {
        assert_eq!(to_match_query("借用").as_deref(), Some("\"借 用\""));
        assert_eq!(
            to_match_query("Rust 借用").as_deref(),
            Some("\"Rust\" \"借 用\"")
        );
        // Single character still becomes a valid one-token phrase.
        assert_eq!(to_match_query("借").as_deref(), Some("\"借\""));
    }

    #[test]
    fn match_query_ignores_blank_input() {
        assert_eq!(to_match_query(""), None);
        assert_eq!(to_match_query("   "), None);
        assert_eq!(to_match_query("!!!"), None);
    }

    #[test]
    fn snippet_centres_on_the_match() {
        let raw = "第一章 所有权。借用检查器在编译期阻止数据竞争，这是 Rust 的核心特点之一。";
        let snippet = make_snippet(raw, "借用", 12);
        assert!(snippet.contains("借用"), "unexpected snippet: {snippet}");
        assert!(snippet.chars().count() <= 14, "snippet too long: {snippet}");
    }

    #[test]
    fn snippet_handles_missing_match_and_empty_input() {
        assert_eq!(make_snippet("", "借用", 12), "");
        let snippet = make_snippet("hello world", "借用", 12);
        assert_eq!(snippet, "hello world");
    }
}
