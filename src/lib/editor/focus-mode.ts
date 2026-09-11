import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

export const focusModeKey = new PluginKey<DecorationSet>("qjFocusMode");

/** Range of the top-level block that holds the selection. */
export function activeBlockRange(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  if ($from.depth === 0) return null;
  return { from: $from.before(1), to: $from.after(1) };
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
  const decorations: Decoration[] = [];

  state.doc.forEach((node, offset) => {
    const isActive = active !== null && offset === active.from;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: isActive ? "qj-block--active" : "qj-block--dim",
      }),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

export const focusModePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: focusModeKey,
      state: {
        init: (_config, state) => buildFocusDecorations(state),
        apply: (tr, value, _oldState, newState) =>
          tr.docChanged || tr.selectionSet ? buildFocusDecorations(newState) : value,
      },
      props: {
        decorations: (state) => focusModeKey.getState(state) ?? null,
      },
    }),
);
