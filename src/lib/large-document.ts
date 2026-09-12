/**
 * Large-document handling.
 *
 * ProseMirror — and therefore Milkdown Crepe — builds a DOM node for every
 * element, so a note of a few hundred thousand characters used to stall on its
 * first render: the browser had to lay out, shape and paint the whole thing
 * before anything appeared. The app's answer was to open such a note in source
 * mode instead, which is fast but hands the user a raw textarea for a document
 * they asked to edit — the one case where the editor gives up on being an editor.
 *
 * The cost was never the DOM itself but rendering all of it at once, so the
 * document is now handed to the editor whole and the *rendering* is what gets
 * skipped: `content-visibility: auto` on the top-level blocks lets the browser
 * leave everything outside the viewport unlaid-out until it scrolls near. The
 * nodes still exist, so positions, find, the outline and the caret all behave
 * exactly as in a short note.
 *
 * Typing is kept off the whole-document path separately, by the decoration
 * plugins rebuilding only the blocks an edit touched — see
 * `lib/editor/changed-ranges`.
 */

/**
 * Documents at least this many characters long get the skipped-rendering path.
 *
 * There is no cliff at this number: it is where the saving starts to outweigh
 * what containment costs. Skipping rendering means each block is laid out on its
 * own, and the scrollbar is sized from estimates until the blocks below have been
 * seen once, so a note short enough to render instantly anyway is left on the
 * plain path where neither applies.
 */
export const LARGE_DOCUMENT_CHARS = 200_000;

export function isLargeDocument(content: string): boolean {
  return content.length >= LARGE_DOCUMENT_CHARS;
}
