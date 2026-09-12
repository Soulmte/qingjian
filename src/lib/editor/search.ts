import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { changedRanges } from "./changed-ranges";
import {
  centredScrollTop,
  findInSegments,
  indexAtOrAfter,
  isComfortablyVisible,
  mergeMatches,
  withinAny,
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
  /**
   * The highlights for `matches`, kept alongside them.
   *
   * `props.decorations` is consulted on every view update, including ones that
   * changed neither the query nor the document, so building the set there meant
   * a `Decoration` per match and a re-sort of all of them on every redraw. It is
   * built once per state change instead.
   */
  decorations: DecorationSet;
}

type SearchMeta =
  | { type: "set"; query: string; caseSensitive: boolean }
  | { type: "step"; delta: number }
  | { type: "reset" };

export const searchKey = new PluginKey<SearchState>("qjSearch");

/** The state before anything is being searched for. */
export const IDLE: SearchState = {
  query: "",
  caseSensitive: false,
  index: 0,
  matches: [],
  decorations: DecorationSet.empty,
};

/** Every text node, paired with the document position it starts at. */
export function collectSegments(doc: ProseNode): TextSegment[] {
  return segmentsIn(doc, 0, doc.content.size);
}

/**
 * The text nodes overlapping `[from, to]`.
 *
 * `nodesBetween` visits only the subtree the range touches, so re-scanning after
 * an edit costs what the edit did rather than what the document holds. A node
 * that straddles the boundary is reported whole: match ranges are document
 * positions, and half a node would produce offsets that do not line up.
 */
function segmentsIn(doc: ProseNode, from: number, to: number): TextSegment[] {
  const segments: TextSegment[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) segments.push({ text: node.text, start: pos });
    return true;
  });
  return segments;
}

/** The matches and index a search is showing, before its highlights are built. */
type SearchMatchState = Omit<SearchState, "decorations">;

function buildDecorations(doc: ProseNode, search: SearchMatchState): DecorationSet {
  if (search.matches.length === 0) return DecorationSet.empty;

  const decorations = search.matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === search.index ? "qj-search-hit qj-search-hit--current" : "qj-search-hit",
    }),
  );

  return DecorationSet.create(doc, decorations);
}

/**
 * The matches a document edit invalidated, re-found.
 *
 * Match ranges are document positions, so an edit anywhere above a match shifts
 * it — but `tr.mapping` already knows by how much. Only the spans the edit
 * touched have to be searched again, widened by the query length so an
 * occurrence formed across the edit's boundary is still found. Everything else
 * is carried across untouched, which is what keeps typing with the find bar open
 * off the whole-document path.
 */
function remapMatches(previous: SearchMatchState, tr: Transaction): SearchMatch[] {
  const { query, caseSensitive } = previous;
  if (query.length === 0) return [];

  const spans: SearchMatch[] = [];
  const found: SearchMatch[] = [];
  const limit = tr.doc.content.size;

  for (const range of changedRanges(tr)) {
    // A match cannot straddle two text nodes, so the widening only has to cover
    // the query itself: any occurrence overlapping the edit starts within
    // `query.length - 1` of it.
    const from = Math.max(0, range.from - query.length);
    const to = Math.min(limit, range.to + query.length);
    spans.push({ from, to });
    found.push(...findInSegments(segmentsIn(tr.doc, from, to), query, caseSensitive));
  }

  const kept: SearchMatch[] = [];
  for (const match of previous.matches) {
    const from = tr.mapping.map(match.from, -1);
    const to = tr.mapping.map(match.to, 1);
    // A match the edit ran through is no longer the same text; the re-scan of
    // that span is what reports whatever is there now.
    if (to - from !== match.to - match.from) continue;
    const moved = { from, to };
    if (!withinAny(moved, spans)) kept.push(moved);
  }

  return mergeMatches(kept, found);
}

/** A state with its highlights built, so `props.decorations` only reads them. */
function withDecorations(doc: ProseNode, state: SearchMatchState): SearchState {
  return { ...state, decorations: buildDecorations(doc, state) };
}

/**
 * The plugin's whole state transition, as a plain function.
 *
 * Kept out of the `Plugin` so it can be exercised against a bare ProseMirror
 * schema: `$prose` hands its plugin to Milkdown's container rather than
 * returning it, so there is otherwise no way to drive this without a webview —
 * and the incremental re-mapping below is the part that most needs the coverage.
 */
export function nextSearchState(
  value: SearchState,
  tr: Transaction,
): SearchState {
  const meta = tr.getMeta(searchKey) as SearchMeta | undefined;

  if (meta?.type === "reset") return IDLE;

  if (meta?.type === "set") {
    const matches =
      meta.query.length === 0
        ? []
        : findInSegments(collectSegments(tr.doc), meta.query, meta.caseSensitive);
    return withDecorations(tr.doc, {
      query: meta.query,
      caseSensitive: meta.caseSensitive,
      matches,
      index: wrapIndex(0, matches.length),
    });
  }

  if (meta?.type === "step") {
    return withDecorations(tr.doc, {
      ...value,
      index: wrapIndex(value.index + meta.delta, value.matches.length),
    });
  }

  if (!tr.docChanged) return value;
  // Nothing is being searched for, so there is nothing to carry across.
  if (value.query.length === 0) return value;

  // The document moved under us. The current match is followed to where it ended
  // up, so an edit elsewhere does not send the find bar back to the first hit.
  const anchor = value.matches[value.index];
  const matches = remapMatches(value, tr);
  const index =
    anchor === undefined ? 0 : indexAtOrAfter(matches, tr.mapping.map(anchor.from, -1));

  return withDecorations(tr.doc, {
    ...value,
    matches,
    index: wrapIndex(index, matches.length),
  });
}

export const searchPlugin = $prose(
  () =>
    new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => IDLE,
        apply: (tr, value) => nextSearchState(value, tr),
      },
      props: {
        decorations: (state) => searchKey.getState(state)?.decorations ?? null,
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
