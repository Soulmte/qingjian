import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import {
  changedRanges,
  forEachBlockIn,
  rebuildRanges,
  type DocRange,
} from "./changed-ranges";

export const focusModeKey = new PluginKey<FocusState>("qjFocusMode");

export interface FocusState {
  decorations: DecorationSet;
  /** Start of the block that was active when `decorations` was built. */
  activeFrom: number | null;
}

/** Range of the top-level block that holds the selection. */
export function activeBlockRange(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  if ($from.depth === 0) return null;
  return { from: $from.before(1), to: $from.after(1) };
}

/** The class a block gets: the one holding the caret is the undimmed one. */
function focusClass(isActive: boolean): string {
  return isActive ? "qj-block--active" : "qj-block--dim";
}

/**
 * Tags every top-level block so CSS can dim all but the active one.
 *
 * The classes are always present; the visual effect is gated on a class on the
 * editor host. That way toggling focus mode is a class swap rather than an
 * editor rebuild, which would throw away undo history for a mode people flip
 * on and off while writing.
 */
export function buildFocusDecorations(state: EditorState): DecorationSet {
  const active = activeBlockRange(state);
  return DecorationSet.create(
    state.doc,
    focusDecorationsIn(state.doc, 0, state.doc.content.size, active?.from ?? null),
  );
}

/** The decorations for the blocks overlapping `[from, to]`. */
function focusDecorationsIn(
  doc: ProseNode,
  from: number,
  to: number,
  activeFrom: number | null,
): Decoration[] {
  const decorations: Decoration[] = [];

  forEachBlockIn(doc, from, to, (node, pos) => {
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { class: focusClass(pos === activeFrom) }),
    );
  });

  return decorations;
}

/**
 * Which spans have to be rebuilt after a transaction.
 *
 * Moving the caret only changes two blocks — the one it left and the one it
 * arrived in — so those are the only ranges reported for a selection change.
 * Rebuilding the whole document on every arrow key, which is what this used to
 * do, is what made a long note feel heavy in focus mode.
 *
 * Coalescing is left to `rebuildRanges`, which widens each span to whole blocks
 * first: merging here would join the block the caret left to the one it entered
 * before either had been widened.
 */
function staleRanges(
  tr: Transaction,
  previousActive: number | null,
  nextActive: DocRange | null,
): DocRange[] {
  const ranges = tr.docChanged ? changedRanges(tr) : [];

  const mappedPrevious =
    previousActive === null
      ? null
      : tr.docChanged
        ? tr.mapping.map(previousActive, -1)
        : previousActive;

  if (mappedPrevious !== null && mappedPrevious !== (nextActive?.from ?? null)) {
    ranges.push({ from: mappedPrevious, to: mappedPrevious });
  }
  if (nextActive) ranges.push(nextActive);

  return ranges;
}

/**
 * The plugin's state transition, as a plain function.
 *
 * Exported for the same reason `nextSearchState` is: `$prose` hands its plugin to
 * Milkdown's container rather than returning it, so this is the only way to drive
 * the incremental path without a webview.
 */
export function nextFocusState(
  value: FocusState,
  tr: Transaction,
  next: EditorState,
): FocusState {
  if (!tr.docChanged && !tr.selectionSet) return value;

  const active = activeBlockRange(next);
  const ranges = staleRanges(tr, value.activeFrom, active);
  const activeFrom = active?.from ?? null;
  const doc = next.doc;

  const mapped = tr.docChanged ? value.decorations.map(tr.mapping, doc) : value.decorations;

  return {
    decorations: rebuildRanges(mapped, doc, ranges, (target, from, to) =>
      focusDecorationsIn(target, from, to, activeFrom),
    ),
    activeFrom,
  };
}

/** The state for a document nothing has happened to yet. */
export function initialFocusState(state: EditorState): FocusState {
  return {
    decorations: buildFocusDecorations(state),
    activeFrom: activeBlockRange(state)?.from ?? null,
  };
}

export const focusModePlugin = $prose(
  () =>
    new Plugin<FocusState>({
      key: focusModeKey,
      state: {
        init: (_config, state) => initialFocusState(state),
        apply: (tr, value, _oldState, newState) => nextFocusState(value, tr, newState),
      },
      props: {
        decorations: (state) => focusModeKey.getState(state)?.decorations ?? null,
      },
    }),
);
