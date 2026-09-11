import type { Align } from "@/lib/editor/align";
import { alignmentOf, stripAlignment } from "@/lib/editor/image-align";
import { parseFrontMatter } from "@/lib/front-matter";

import { toMathML } from "./mathml";

/**
 * The document shape every exporter renders.
 *
 * Markdown is parsed once, here, and the same tree is then rendered to HTML,
 * Word or plain text. Parsing on this side rather than in Rust means the export
 * sees exactly what the editor sees — the alignment markers and image paths
 * included — and it keeps the renderers to pure formatting work.
 *
 * Nothing here needs a DOM, so the whole parser is exercised by unit tests.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "strike"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string }
  | {
      t: "image";
      v: string;
      src: string;
      file?: string;
      /** The scale the editor stored; absent means the image's natural size. */
      ratio?: number;
    }
  /** A line break inside a paragraph. Carries no text of its own. */
  | { t: "br" }
  /**
   * A formula: the LaTeX source and its MathML rendering. `mathml` is empty when
   * KaTeX could not parse it, and the renderers then show `tex` as code.
   */
  | { t: "math"; tex: string; mathml: string }
  /**
   * Raw inline HTML, kept verbatim.
   *
   * Markdown allows it and the editor round-trips it, so `<kbd>` and `<sub>` in a
   * note have to reach the exported page as markup. Only the tags in
   * [`HTML_TAGS`] are recognised, and only without attributes.
   */
  | { t: "html"; v: string };

export interface ListItem {
  blocks: Block[];
  /** Set for a `- [ ]` / `- [x]` item; absent for an ordinary one. */
  checked?: boolean;
}

export type Block =
  | { t: "heading"; level: number; align: Align; runs: Inline[] }
  | { t: "paragraph"; align: Align; runs: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "table"; aligns: (Align | null)[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" }
  | {
      t: "image";
      align: Align;
      src: string;
      file?: string;
      /** The scale the editor stored; absent means the image's natural size. */
      ratio?: number;
      caption: string;
    }
  /** A display formula, stored in the note as `$$ … $$`. */
  | { t: "mathBlock"; tex: string; mathml: string };

export interface ParseOptions {
  /** Maps a Markdown image path to an absolute file, when one can be found. */
  resolveImageFile?: (src: string) => string | undefined;
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                     */
/* -------------------------------------------------------------------------- */

/** An `alt` that is nothing but a number: the scale, not a description. */
const NUMERIC_ALT = /^\d+(?:\.\d+)?$/;

/**
 * The scale the editor stored for an image, or `undefined` for "natural size".
 *
 * An image block has exactly three fields — `src`, `caption` and `ratio` — and
 * Markdown's image node only carries `src`, `alt` and `title`. So the editor
 * writes the ratio into the `alt` (`![0.44](a.png "说明")`), leaving the real
 * caption in the title. Without this an image the user shrank exports at full
 * width, which is exactly what it looked like was happening.
 *
 * Anything else in the alt is a description somebody wrote by hand, and those
 * keep the natural size.
 */
export function imageScale(alt: string): number | undefined {
  const trimmed = alt.trim();
  if (!NUMERIC_ALT.test(trimmed)) return undefined;

  const value = Number.parseFloat(trimmed);
  // The loader treats a missing or zero ratio as "natural", and the text column
  // is the upper bound on paper, so a larger value is clamped rather than kept.
  if (!(value > 0)) return undefined;
  return Math.min(value, 1);
}

/**
 * Inline HTML the exporters pass through.
 *
 * Deliberately small, and attributes are not accepted: this is the markup a
 * writer reaches for in prose, not a way to embed a page. Anything outside the
 * list — or any `<span style=…>` — stays literal text, which is both what the
 * reader typed and the safe answer.
 */
const HTML_TAGS =
  "kbd|sub|sup|u|mark|b|i|em|strong|code|del|ins|s|small|span|abbr|cite|q|big";
const HTML_TAG = new RegExp(`^</?(?:${HTML_TAGS})\\s*/?>`, "i");

/** The element name of a tag, lower-cased: `</SUB>` becomes `sub`. */
function tagName(tag: string): string {
  return tag.replace(/^<\/?/, "").replace(/\/?>$/, "").trim().toLowerCase();
}

const INLINE_RULES: { pattern: RegExp; make: (match: RegExpExecArray) => Inline }[] = [
  // Milkdown writes an empty paragraph as `<br />`, so this is also how a blank
  // line reaches the exporter — it must not survive as visible text.
  { pattern: /^<br\s*\/?>/i, make: () => ({ t: "br" }) },
  // Inline maths, as the editor writes it. The lookarounds are what keep `$5 and
  // $10` and a stray `$$` from being read as a formula: the content may not begin
  // or end with a space, and the group cannot cross a `$`.
  {
    pattern: /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$/,
    make: (m) => ({ t: "math", tex: m[1], mathml: toMathML(m[1], false) }),
  },
  {
    pattern: /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/,
    make: (m) => {
      const ratio = imageScale(m[1]);
      return {
        t: "image",
        // A numeric alt is the size, not the description.
        v: ratio === undefined ? m[1] : "",
        src: stripAlignment(m[2]),
        ...(ratio === undefined ? {} : { ratio }),
      };
    },
  },
  {
    pattern: /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/,
    make: (m) => ({ t: "link", v: m[1], href: m[2] }),
  },
  { pattern: /^\*\*(.+?)\*\*/, make: (m) => ({ t: "bold", v: m[1] }) },
  { pattern: /^__(.+?)__/, make: (m) => ({ t: "bold", v: m[1] }) },
  { pattern: /^\*([^*]+)\*/, make: (m) => ({ t: "italic", v: m[1] }) },
  { pattern: /^_([^_]+)_/, make: (m) => ({ t: "italic", v: m[1] }) },
  { pattern: /^~~([^~]+)~~/, make: (m) => ({ t: "strike", v: m[1] }) },
  { pattern: /^`([^`]+)`/, make: (m) => ({ t: "code", v: m[1] }) },
  // A backslash escape is the one place a literal marker survives.
  { pattern: /^\\([\\`*_{}[\]()#+\-.!>~|$])/, make: (m) => ({ t: "text", v: m[1] }) },
];

/**
 * Splits a line into emphasised runs.
 *
 * Emphasis is deliberately not nested: `**a *b* c**` becomes one bold run with
 * the inner asterisks kept literally. Nesting properly needs a real CommonMark
 * parser, and the renderers would then have to carry nested run properties
 * through Word as well.
 */
export function parseInline(text: string, options: ParseOptions = {}): Inline[] {
  const runs: Inline[] = [];
  let literal = "";
  let index = 0;
  /** The tags opened and not yet closed in this block. */
  const open: string[] = [];

  const flush = () => {
    if (literal) {
      runs.push({ t: "text", v: literal });
      literal = "";
    }
  };

  while (index < text.length) {
    // A hard break inside a paragraph arrives as a newline from the block
    // scanner; it is a break run rather than a character.
    if (text[index] === "\n") {
      flush();
      runs.push({ t: "br" });
      index += 1;
      continue;
    }

    const rest = text.slice(index);

    // Raw inline HTML, kept as markup rather than escaped into visible brackets
    // — but only when it is well formed. A closing tag is accepted only if it
    // closes the innermost open one, so a stray `</span>` cannot become markup
    // that closes nothing, and a tag whose attributes are refused takes its
    // partner down with it.
    if (rest[0] === "<") {
      const tag = HTML_TAG.exec(rest);
      if (tag) {
        const name = tagName(tag[0]);
        const closing = tag[0][1] === "/";
        const selfClosing = tag[0].endsWith("/>");
        const wellFormed = closing ? open[open.length - 1] === name : !selfClosing;

        if (wellFormed) {
          if (closing) open.pop();
          else open.push(name);
          flush();
          runs.push({ t: "html", v: tag[0] });
          index += tag[0].length;
          continue;
        }
      }
    }

    const rule = INLINE_RULES.find((candidate) => candidate.pattern.test(rest));

    if (!rule) {
      literal += text[index];
      index += 1;
      continue;
    }

    const match = rule.pattern.exec(rest)!;
    flush();
    const run = rule.make(match);
    if (run.t === "image") {
      // Resolved here rather than at render time so the renderers stay pure.
      const file = options.resolveImageFile?.(run.src);
      runs.push(file ? { ...run, file } : run);
    } else {
      runs.push(run);
    }
    index += match[0].length;
  }

  flush();
  return mergeText(runs);
}

/** Folds neighbouring literal runs together, so escapes do not split a word. */
function mergeText(runs: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (run.t === "text" && previous?.t === "text") {
      merged[merged.length - 1] = { t: "text", v: previous.v + run.v };
    } else {
      merged.push(run);
    }
  }
  return merged;
}

/** Whether a run list says anything a reader would see. */
function hasContent(runs: Inline[]): boolean {
  return runs.some((run) => {
    if (run.t === "br" || run.t === "html") return false;
    // A formula's text is its source; the rendering is a bonus.
    return (run.t === "math" ? run.tex : run.v).trim() !== "";
  });
}

/**
 * Builds a paragraph from the lines it was written on.
 *
 * A trailing backslash or two trailing spaces is a hard break, which becomes a
 * `br` run instead of a space. A paragraph holding nothing but breaks is how the
 * editor stores a blank line, so it collapses to an empty paragraph rather than
 * exporting the `<br />` the file literally contains.
 */
function paragraphBlock(lines: string[], align: Align, options: ParseOptions): Block {
  const parts: string[] = [];
  lines.forEach((line, position) => {
    const trimmedEnd = line.trimEnd();
    const hard = /\\$/.test(trimmedEnd) || /\s{2,}$/.test(line);
    parts.push(hard ? trimmedEnd.replace(/\\$/, "").trimEnd() : line.trim());
    if (position < lines.length - 1) parts.push(hard ? "\n" : " ");
  });

  const runs = parseInline(parts.join(""), options);
  return { t: "paragraph", align, runs: hasContent(runs) ? runs : [] };
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

const FENCE = /^\s*```\s*([\w+#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const LONE_IMAGE = /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)\s*$/;

/** A `$$` line of its own, which opens or closes a display formula. */
const MATH_FENCE = /^\s*\$\$\s*$/;
/** A whole formula on one line: `$$ … $$`. */
const MATH_ONE_LINE = /^\s*\$\$(.+?)\$\$\s*$/;

/** A fenced block the editor uses for display maths. */
const LATEX_LANG = /^(latex|tex)$/i;

/** The display-formula block for a piece of LaTeX. */
function mathBlock(tex: string): Block {
  return { t: "mathBlock", tex, mathml: toMathML(tex, true) };
}

/** The `<!-- qj-align:x -->` line the editor writes before an aligned block. */
const ALIGN_MARKER = /^<!--\s*qj-align:(left|center|right)\s*-->$/;

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  if (!line || !line.trim()) return true;
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  if (MATH_FENCE.test(line) || MATH_ONE_LINE.test(line)) return true;
  if (LIST_ITEM.test(line) || LONE_IMAGE.test(line) || ALIGN_MARKER.test(line.trim())) return true;
  return isTableStart(lines, index);
}

function isTableStart(lines: string[], index: number): boolean {
  const delimiter = lines[index + 1];
  if (!lines[index].includes("|") || !delimiter || !delimiter.includes("|")) return false;
  const cells = splitRow(delimiter);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Parses a document into blocks.
 *
 * Alignment for a block comes from the marker comment on the line above it, the
 * same convention the editor writes; images carry their own alignment in the URL
 * fragment instead.
 *
 * A leading YAML block is metadata and never body text, so it is lifted off
 * first — otherwise its delimiters would render as a rule and its keys as a
 * heading.
 */
export function parseMarkdown(markdown: string, options: ParseOptions = {}): Block[] {
  const { body } = parseFrontMatter(markdown);
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return parseRange(lines, 0, lines.length, options).blocks;
}

function parseRange(
  lines: string[],
  from: number,
  to: number,
  options: ParseOptions,
): { blocks: Block[]; next: number } {
  const blocks: Block[] = [];
  let pending: Align | null = null;
  let index = from;

  /** Gives the pending marker to the block that follows, then clears it. */
  const take = (): Align => {
    const align = pending ?? "left";
    pending = null;
    return align;
  };

  while (index < to) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const marker = ALIGN_MARKER.exec(line.trim());
    if (marker) {
      pending = marker[1] as Align;
      index += 1;
      continue;
    }

    const oneLineMath = MATH_ONE_LINE.exec(line);
    if (oneLineMath) {
      take();
      blocks.push(mathBlock(oneLineMath[1].trim()));
      index += 1;
      continue;
    }

    if (MATH_FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < to && !MATH_FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < to) index += 1;
      take();
      blocks.push(mathBlock(body.join("\n").trim()));
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < to && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      // Skip the closing fence when there is one; an unterminated block simply
      // runs to the end, which is what the editor shows too.
      if (index < to) index += 1;
      take();
      // The editor stores a display formula as a `latex` code block, so a file
      // written by hand and one written here both have to come out as maths.
      if (fence[1] && LATEX_LANG.test(fence[1])) {
        blocks.push(mathBlock(body.join("\n").trim()));
        continue;
      }
      blocks.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        t: "heading",
        level: heading[1].length,
        align: take(),
        runs: parseInline(heading[2].trim(), options),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      take();
      blocks.push({ t: "hr" });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < to && QUOTE.test(lines[index])) {
        body.push(QUOTE.exec(lines[index])![1]);
        index += 1;
      }
      take();
      blocks.push({ t: "quote", blocks: parseRange(body, 0, body.length, options).blocks });
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index, to, options);
      take();
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, index, to, options);
      take();
      blocks.push(...list.blocks);
      index = list.next;
      continue;
    }

    const image = LONE_IMAGE.exec(line);
    if (image) {
      const src = stripAlignment(image[2]);
      const file = options.resolveImageFile?.(src);
      const ratio = imageScale(image[1]);
      take();
      blocks.push({
        t: "image",
        align: alignmentOf(image[2]),
        src,
        ...(file ? { file } : {}),
        ...(ratio === undefined ? {} : { ratio }),
        caption: image[3] ?? "",
      });
      index += 1;
      continue;
    }

    // Anything else is a paragraph: consecutive lines up to a blank line or the
    // start of another block.
    const paragraph: string[] = [];
    while (index < to && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push(paragraphBlock(paragraph, take(), options));
    }
  }

  return { blocks, next: index };
}

function parseTable(
  lines: string[],
  start: number,
  to: number,
  options: ParseOptions,
): { block: Extract<Block, { t: "table" }>; next: number } {
  const head = splitRow(lines[start]).map((cell) => parseInline(cell, options));
  const aligns = splitRow(lines[start + 1]).map<Align | null>((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

  const rows: Inline[][][] = [];
  let index = start + 2;
  while (index < to && lines[index].trim() && lines[index].includes("|")) {
    rows.push(splitRow(lines[index]).map((cell) => parseInline(cell, options)));
    index += 1;
  }

  return { block: { t: "table", aligns, head, rows }, next: index };
}

interface RawItem {
  indent: number;
  ordered: boolean;
  text: string;
  children: RawItem[];
}

function parseList(
  lines: string[],
  start: number,
  to: number,
  options: ParseOptions,
): { blocks: Block[]; next: number } {
  const roots: RawItem[] = [];
  const stack: RawItem[] = [];
  let index = start;

  while (index < to) {
    const line = lines[index];
    const match = LIST_ITEM.exec(line);

    if (!match) {
      // An indented, non-blank line continues the item above it; anything else
      // ends the list.
      const isContinuation = /^\s+\S/.test(line) && stack.length > 0;
      if (!isContinuation) break;
      stack[stack.length - 1].text += ` ${line.trim()}`;
      index += 1;
      continue;
    }

    const item: RawItem = {
      indent: match[1].replace(/\t/g, "    ").length,
      ordered: /\d/.test(match[2]),
      text: match[3],
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) stack.pop();
    if (stack.length === 0) roots.push(item);
    else stack[stack.length - 1].children.push(item);
    stack.push(item);
    index += 1;
  }

  return { blocks: groupLists(roots, options), next: index };
}

/** Turns raw items into list blocks, splitting when the marker kind changes. */
function groupLists(items: RawItem[], options: ParseOptions): Block[] {
  const blocks: Block[] = [];
  let run: RawItem[] = [];
  let runOrdered = false;

  const flush = () => {
    if (run.length === 0) return;
    blocks.push({
      t: "list",
      ordered: runOrdered,
      items: run.map((item) => toItem(item, options)),
    });
    run = [];
  };

  for (const item of items) {
    if (run.length > 0 && item.ordered !== runOrdered) flush();
    if (run.length === 0) runOrdered = item.ordered;
    run.push(item);
  }
  flush();

  return blocks;
}

function toItem(item: RawItem, options: ParseOptions): ListItem {
  // `- [ ]` / `- [x]` is a task item; the box is a state the exporters draw,
  // not text the reader should see as "[ ]".
  const task = /^\[([ xX])\]\s*/.exec(item.text);
  const text = task ? item.text.slice(task[0].length) : item.text;

  const blocks: Block[] = [];
  const runs = text.trim() ? parseInline(text, options) : [];
  // An item whose only content is a break (as `- [ ] <br />` is) stays empty
  // rather than gaining a stray blank line.
  if (hasContent(runs)) blocks.push({ t: "paragraph", align: "left", runs });
  blocks.push(...groupLists(item.children, options));

  return task ? { blocks, checked: task[1].toLowerCase() === "x" } : { blocks };
}
