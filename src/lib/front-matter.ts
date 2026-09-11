/**
 * YAML front matter — the `---` block a note may start with.
 *
 * The rich-text editor has no node for it, and Markdown itself has no syntax:
 * a parser reads the opening `---` as a thematic break and the closing one as a
 * setext underline, so `title: 论文` would come back as a level-2 heading. Rather
 * than grow the schema, the block is lifted off before the editor sees the text
 * and put back on the way out, which keeps the file byte-identical and lets the
 * metadata be edited through a dialog instead of the WYSIWYG surface.
 *
 * Nothing here needs a YAML parser: only the delimiters are structural, and the
 * few keys the app cares about (`title` above all) are read line by line.
 */

/** The block, verbatim, and the document that follows it. */
export interface FrontMatter {
  /** Delimiters and body with a trailing newline, or `""` when there is none. */
  raw: string;
  /** Everything after the block, with the separating blank lines removed. */
  body: string;
}

/** A delimiter line: `---` or `...`, which is also how YAML ends a document. */
const DELIMITER = /^(?:---|\.\.\.)[ \t]*$/;
const OPENER = /^---[ \t]*$/;

/**
 * Splits a document into its front matter and its body.
 *
 * The block only counts when it is unbroken: the opener on the very first line,
 * no blank line after it, and a closing delimiter before the next blank line.
 * Those conditions are what separate metadata from the case that would otherwise
 * swallow a document — two thematic breaks with text between them, which is what
 * an editor writes for `---`, a paragraph, `---`. Blocks are always separated by
 * a blank line, so a real document can never match this shape by accident.
 */
export function parseFrontMatter(markdown: string): FrontMatter {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (!OPENER.test(lines[0] ?? "")) return { raw: "", body: markdown };
  if ((lines[1] ?? "").trim() === "") return { raw: "", body: markdown };

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") break;
    if (DELIMITER.test(lines[index])) {
      end = index;
      break;
    }
  }
  // An unterminated block is not front matter; it is a break followed by text.
  if (end === -1) return { raw: "", body: markdown };

  const raw = `${lines.slice(0, end + 1).join("\n")}\n`;
  // Blank lines between the block and the first paragraph are separators, not
  // content, so they are dropped here and restored by `withFrontMatter`.
  let start = end + 1;
  while (start < lines.length && lines[start].trim() === "") start += 1;

  return { raw, body: lines.slice(start).join("\n") };
}

/** Puts a block back in front of a body, with one blank line between them. */
export function withFrontMatter(raw: string, body: string): string {
  if (!raw.trim()) return body;
  return body ? `${raw}\n${body}` : raw;
}

/**
 * Reads a top-level scalar out of the block.
 *
 * Quoted values lose their quotes; `#` comments and nested structures are left
 * alone, because the app only reads the handful of keys it displays.
 */
export function frontMatterValue(raw: string, key: string): string | null {
  if (!raw) return null;

  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match || match[1].toLowerCase() !== key.toLowerCase()) continue;

    let value = match[2].trim();
    if (value.length > 1) {
      const first = value[0];
      if ((first === '"' || first === "'") && value.endsWith(first)) {
        value = value.slice(1, -1).trim();
      }
    }
    return value || null;
  }
  return null;
}

/** The top-level keys, in the order they appear; used for the editor's chip. */
export function frontMatterKeys(raw: string): string[] {
  if (!raw) return [];

  const keys: string[] = [];
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (match && !keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

/** The block's `title`, which outranks the first heading as a note's name. */
export function frontMatterTitle(markdown: string): string | null {
  const { raw } = parseFrontMatter(markdown);
  const title = frontMatterValue(raw, "title");
  return title ? Array.from(title).slice(0, 120).join("") : null;
}

/**
 * Turns what the user typed in the metadata dialog into a valid block.
 *
 * Only the keys have to be typed: a draft without fences is wrapped, and one
 * with an opening fence but no closing fence gets one appended. What is stored
 * has to be terminated, or the parser would read the whole thing as body text.
 */
export function normalizeFrontMatter(draft: string): string {
  const text = draft.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";

  const lines = text.split("\n");
  const closed = lines
    .slice(1)
    .some((line) => DELIMITER.test(line));

  if (!OPENER.test(lines[0])) return `---\n${text}\n---\n`;
  return closed ? `${text}\n` : `${text}\n---\n`;
}
