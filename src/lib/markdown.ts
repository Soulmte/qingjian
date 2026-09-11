/**
 * Lightweight Markdown introspection for the UI. The Rust side does the same
 * for the stored title; this copy exists so the sidebar can update as you type
 * without a round trip.
 */

import { frontMatterTitle, parseFrontMatter } from "@/lib/front-matter";

/**
 * The note's display name: the metadata `title`, else the first heading, else
 * the first non-empty line, else the fallback.
 */
export function extractTitle(content: string, fallback: string): string {
  const fromMetadata = frontMatterTitle(content);
  if (fromMetadata) return fromMetadata;

  const { body } = parseFrontMatter(content);
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || isNoiseLine(trimmed)) continue;

    const withoutHashes = trimmed.replace(/^#+/, "").trim();
    const text = (withoutHashes.length === trimmed.length ? trimmed : withoutHashes)
      .replace(/^\*+|\*+$/g, "")
      .trim();

    if (text.length > 0) return Array.from(text).slice(0, 120).join("");
  }
  return fallback;
}

/**
 * Whether a line carries no words: a rule, a fence, or an alignment marker.
 * Without this a note that opens with `---` would be named after it.
 */
function isNoiseLine(line: string): boolean {
  if (line.startsWith("<!--") || line.startsWith("```") || line.startsWith("~~~")) return true;
  return /^[-*_=>#\s]+$/.test(line);
}

/**
 * Counts CJK characters individually and Latin words as units, which matches
 * how Chinese and English writers expect a word counter to behave.
 */
export function countWords(content: string): number {
  const { body } = parseFrontMatter(content);
  const cjk = body.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const latin = body.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/**
 * Characters in a document, counting a surrogate pair (an emoji, a rare CJK
 * character) once.
 *
 * Replaces `Array.from(content).length`, which allocated an array of every
 * character in the document — millions of entries on a large note, rebuilt on
 * every keystroke. This walks the code units instead and never allocates.
 */
export function countCharacters(content: string): number {
  let count = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < content.length) {
      const next = content.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

/** Reads the heading levels out of the document for the outline panel. */
export interface OutlineItem {
  level: number;
  text: string;
  /** Zero-based index of the heading among all lines, used as a stable key. */
  line: number;
}

export function parseOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = content.split("\n");
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) return;

    const text = match[2].replace(/#+\s*$/, "").trim();
    if (text.length > 0) items.push({ level: match[1].length, text, line: index });
  });

  return items;
}
