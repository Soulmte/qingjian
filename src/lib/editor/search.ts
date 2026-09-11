import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import {
  centredScrollTop,
  findInSegments,
  isComfortablyVisible,
  wrapIndex,
  type SearchMatch,
  type TextSegment,
} from "./search-utils";

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  /** Index into `matches`. */
  index: number;
  matches: SearchMatch[];
}

type SearchMeta =
  | { type: "set"; query: string; caseSensitive: boolean }
  | { type: "step"; delta: number }
  | { type: "reset" };

export const searchKey = new PluginKey<SearchState>("qjSearch");

const IDLE: SearchState = { query: "", caseSensitive: false, index: 0, matches: [] };

/** Every text node, paired with the document position it starts at. */
export function collectSegments(doc: ProseNode): TextSegment[] {
  const segments: TextSegment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, start: pos });
    return true;
  });
  return segments;
}

function buildDecorations(state: EditorState): DecorationSet {
  const search = searchKey.getState(state);
  if (!search || search.matches.length === 0) return DecorationSet.empty;

  const decorations = search.matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === search.index ? "qj-search-hit qj-search-hit--current" : "qj-search-hit",
    }),
  );

  return DecorationSet.create(state.doc, decorations);
}

export const searchPlugin = $prose(
  () =>
    new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => IDLE,
        apply: (tr, value) => {
          const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
          let next = value;

          if (meta?.type === "set") {
            next = { ...value, query: meta.query, caseSensitive: meta.caseSensitive, index: 0 };
          } else if (meta?.type === "step") {
            next = { ...value, index: value.index + meta.delta };
          } else if (meta?.type === "reset") {
            next = IDLE;
          }

          // Recompute when the query changed or the document moved under us.
          if (meta?.type === "set" || meta?.type === "reset" || tr.docChanged) {
            next = {
              ...next,
              matches: findInSegments(collectSegments(tr.doc), next.query, next.caseSensitive),
            };
          }

          return { ...next, index: wrapIndex(next.index, next.matches.length) };
        },
      },
      props: {
        decorations: (state) => buildDecorations(state),
      },
    }),
);

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

export function readSearch(view: EditorView): SearchState {
  return searchKey.getState(view.state) ?? IDLE;
}

export function setSearchQuery(view: EditorView, query: string, caseSensitive: boolean): void {
  view.dispatch(view.state.tr.setMeta(searchKey, { type: "set", query, caseSensitive }));

  // Typing a query shows the first hit straight away, the way a browser's find
  // does; otherwise a match far down the document would be highlighted but
  // invisible.
  const state = readSearch(view);
  const match = state.matches[state.index];
  if (match) revealMatch(view, match);
}

/** How much of a match must be inside the viewport for it to count as visible. */
const VISIBLE_MARGIN = 48;

/**
 * Brings a match into view when it is not already there.
 *
 * ProseMirror's own `scrollIntoView` cannot be used here: its `scrollToSelection`
 * reads the *DOM* selection and gives up entirely when that is not inside the
 * editor — which is the case whenever the find bar has the focus, i.e. exactly
 * when this runs. So the geometry is worked out here instead, against the
 * editor's own scroll container.
 *
 * A match that is already comfortably visible is left alone, so stepping through
 * several matches in a row does not make the page jump around.
 */
function revealMatch(view: EditorView, match: SearchMatch): void {
  const scroller = view.dom.closest(".editor-scroll");
  if (!(scroller instanceof HTMLElement)) return;

  let top: number;
  let bottom: number;
  try {
    const start = view.coordsAtPos(match.from);
    const end = view.coordsAtPos(match.to);
    top = Math.min(start.top, end.top);
    bottom = Math.max(start.bottom, end.bottom);
  } catch {
    // The position is no longer laid out; there is nothing to scroll to.
    return;
  }

  const box = scroller.getBoundingClientRect();
  if (isComfortablyVisible(top, bottom, box.top, box.bottom, VISIBLE_MARGIN)) return;

  // Centred, which is where the eye already is after a jump.
  scroller.scrollTo({
    top: centredScrollTop(scroller.scrollTop, top, box.top, box.height, bottom - top),
    behavior: "smooth",
  });
}

/** Moves to the next or previous match and scrolls it into view. */
export function stepSearch(view: EditorView, delta: number): void {
  const before = readSearch(view);
  if (before.matches.length === 0) return;

  const index = wrapIndex(before.index + delta, before.matches.length);
  view.dispatch(view.state.tr.setMeta(searchKey, { type: "step", delta }));

  const match = before.matches[index];
  if (!match) return;

  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
      .scrollIntoView(),
  );

  revealMatch(view, match);
}

export function replaceCurrentMatch(view: EditorView, replacement: string): boolean {
  const search = readSearch(view);
  const match = search.matches[search.index];
  if (!match) return false;

  view.dispatch(view.state.tr.insertText(replacement, match.from, match.to));
  return true;
}

/**
 * Replaces every match, returning how many were replaced.
 *
 * Edits are applied from the end of the document backwards: each `insertText`
 * position is interpreted against the document as already transformed by the
 * earlier steps, so working backwards keeps every range valid.
 */
export function replaceAllMatches(view: EditorView, replacement: string): number {
  const search = readSearch(view);
  if (search.matches.length === 0) return 0;

  const tr = view.state.tr;
  for (let i = search.matches.length - 1; i >= 0; i -= 1) {
    const match = search.matches[i];
    tr.insertText(replacement, match.from, match.to);
  }
  view.dispatch(tr);

  return search.matches.length;
}

export function clearSearch(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchKey, { type: "reset" }));
}
