/**
 * Clean-up for the markdown the editor hands back.
 *
 * Milkdown writes an *empty table cell* as `<br />`, and that tag goes straight
 * into the file: it renders as nothing, but every other editor reads it as a
 * literal break, so a table the user never typed a break into arrives in the
 * source full of tags. The export path already folds the same artefact on the
 * way in (see `export/ir.ts`); this is the write side of that.
 */

/** A cell whose whole content is a break — the artifact, not a real line break. */
const EMPTY_BREAK_CELL = /^<br\s*\/?>$/i;

/**
 * Splits a table row on its unescaped pipes.
 *
 * `\|` is a literal pipe inside a cell, so a plain `split("|")` would cut the
 * cell in half. The leading and trailing pipes of a row come back as empty edge
 * entries, which `join` puts back unchanged — so a line without an empty cell is
 * returned byte for byte.
 */
function splitCells(line: string): string[] {
  return line.split(/(?<!\\)\|/);
}

/**
 * Replaces cells that hold nothing but `<br />` with genuinely empty cells.
 *
 * A cell that is empty and a cell holding a single break look identical on
 * screen, so folding them together loses nothing — and it keeps a table from
 * growing junk on every save.
 *
 * Only lines that are table rows are touched, and the cheap scan first means a
 * document without the tag pays that and nothing else: this runs on every
 * keystroke, through the whole note. (A case-insensitive test rather than
 * `includes("<br")`, so the guard matches what the pattern below accepts; the
 * cost is one linear scan either way, without copying the document.)
 */
export function normaliseTableBreaks(markdown: string): string {
  if (!/<br/i.test(markdown)) return markdown;

  return markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return line;

      const cells = splitCells(line);
      if (!cells.some((cell) => EMPTY_BREAK_CELL.test(cell.trim()))) return line;

      return cells.map((cell) => (EMPTY_BREAK_CELL.test(cell.trim()) ? " " : cell)).join("|");
    })
    .join("\n");
}
