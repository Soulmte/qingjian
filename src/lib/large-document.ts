/**
 * Large-document handling.
 *
 * ProseMirror — and therefore Milkdown Crepe — builds a node for every element,
 * so from a few hundred thousand characters on, both the first render and every
 * render after it stop feeling instant. A plain textarea stays responsive far
 * longer, so a large document opens in source mode by default and the user can
 * switch to the rich surface if they want it.
 */

/** Documents at least this many characters long open in source mode by default. */
export const LARGE_DOCUMENT_CHARS = 200_000;

export function isLargeDocument(content: string): boolean {
  return content.length >= LARGE_DOCUMENT_CHARS;
}

/** A rough size for the notice, e.g. `约 25 万字`. */
export function describeDocumentSize(content: string): string {
  const wan = content.length / 10_000;
  return wan >= 10 ? `约 ${Math.round(wan)} 万字` : `约 ${wan.toFixed(1)} 万字`;
}
