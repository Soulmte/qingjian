import type { Align } from "./align";

/**
 * Left / centre / right placement for an image block.
 *
 * Crepe's image-block node carries exactly three attributes — `src`, `caption`
 * and `ratio` — and none of them is free:
 *
 * - `caption` is the visible text and the Markdown `title`;
 * - `ratio` is persisted in the Markdown `alt`, which the loader parses with
 *   `Number()`, so it has to stay numeric;
 * - `src` is the only field copied verbatim in both directions.
 *
 * The alignment therefore rides in the URL fragment (`assets/a.png#qj-align=left`).
 * A fragment is ignored by every image renderer, so the file still opens
 * correctly elsewhere, and the default (centre) writes nothing at all — which
 * keeps existing documents byte-identical.
 *
 * Text blocks use a marker comment instead; see `align.ts` for why the two
 * differ.
 */

const FRAGMENT_KEY = "qj-align";

/** The alignment stored in an image URL; centred when it says nothing. */
export function alignmentOf(src: string): Align {
  const value = fragmentParts(src)
    .find((part) => part.startsWith(`${FRAGMENT_KEY}=`))
    ?.slice(FRAGMENT_KEY.length + 1);

  return value === "left" || value === "right" ? value : "center";
}

/** Rewrites the alignment in an image URL, dropping the marker at its default. */
export function withAlignment(src: string, align: Align): string {
  const hash = src.indexOf("#");
  const base = hash === -1 ? src : src.slice(0, hash);
  const parts = fragmentParts(src).filter(
    (part) => part !== FRAGMENT_KEY && !part.startsWith(`${FRAGMENT_KEY}=`),
  );

  if (align !== "center") parts.push(`${FRAGMENT_KEY}=${align}`);
  return parts.length === 0 ? base : `${base}#${parts.join("&")}`;
}

/**
 * The URL an image loader should actually resolve.
 *
 * The fragment has to come off before a workspace-relative path is joined to the
 * workspace root — otherwise `a.png#qj-align=left` is read as one long file name
 * and the image silently fails to load.
 */
export function stripAlignment(src: string): string {
  const hash = src.indexOf("#");
  if (hash === -1) return src;

  const parts = fragmentParts(src).filter(
    (part) => part !== FRAGMENT_KEY && !part.startsWith(`${FRAGMENT_KEY}=`),
  );
  const base = src.slice(0, hash);
  return parts.length === 0 ? base : `${base}#${parts.join("&")}`;
}

function fragmentParts(src: string): string[] {
  const hash = src.indexOf("#");
  return hash === -1 ? [] : src.slice(hash + 1).split("&").filter(Boolean);
}
