/**
 * Skipping the rendering of off-screen blocks, so a long note does not have to
 * be laid out all at once.
 *
 * A note of a few hundred thousand characters is not slow because of the number
 * of DOM nodes; it is slow because the browser shapes and lays out every line of
 * text before it can paint the first one. `content-visibility: auto` lets it
 * postpone that for anything outside the viewport, which is why the document can
 * now be handed to the editor whole instead of being demoted to a textarea.
 *
 * The property is not applied from a stylesheet selector, because it is not safe
 * on every block: `content-visibility: auto` also turns on paint containment,
 * which clips anything a block draws outside its own box. Crepe's table handles,
 * the code-block language picker and the inline-LaTeX editor all do exactly that.
 * So the blocks that are safe are marked by this plugin instead, and the
 * stylesheet only acts on the mark.
 */

import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { forEachBlockIn, syncDecorations } from "./changed-ranges";

/** Class the stylesheet turns into `content-visibility: auto`. */
export const SKIP_RENDER_CLASS = "qj-skip-render";

export const skipRenderKey = new PluginKey<DecorationSet>("qjSkipRender");

/**
 * Block types that never draw outside their own box.
 *
 * Headings are deliberately absent: they are the outline's anchors, and their
 * height is what the panel's scroll positions are read from, so they are left to
 * render normally. They are also short enough that containing them would save
 * nothing.
 *
 * Everything not named here — tables, code blocks, image blocks, block LaTeX —
 * renders eagerly, which is both what correctness requires and cheap, since a
 * document is rarely made mostly of them.
 */
const CONTAINABLE_BLOCKS = new Set([
  "paragraph",
  "blockquote",
  "bullet_list",
  "ordered_list",
  "hr",
]);

/**
 * Whether a block is safe to leave unrendered.
 *
 * The subtree is walked for inline nodes that are not text: an inline image or an
 * inline LaTeX span brings its own editing affordance, drawn over the line it
 * sits on, which paint containment would cut off. The walk stops at the first one
 * found, so an ordinary paragraph costs one pass over its own children.
 */
export function isContainableBlock(node: ProseNode): boolean {
  if (!CONTAINABLE_BLOCKS.has(node.type.name)) return false;

  let safe = true;
  node.descendants((child) => {
    if (!safe) return false;
    if (child.isInline && !child.isText) {
      safe = false;
      return false;
    }
    return true;
  });

  return safe;
}

/** The marks for every containable block overlapping `[from, to]`. */
function skipDecorationsIn(doc: ProseNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = [];

  forEachBlockIn(doc, from, to, (node, pos) => {
    if (isContainableBlock(node)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { class: SKIP_RENDER_CLASS }),
      );
    }
  });

  return decorations;
}

export function buildSkipDecorations(state: EditorState): DecorationSet {
  return DecorationSet.create(
    state.doc,
    skipDecorationsIn(state.doc, 0, state.doc.content.size),
  );
}

export const skipRenderPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: skipRenderKey,
      state: {
        init: (_config, state) => buildSkipDecorations(state),
        apply: (tr, value, _oldState, newState) =>
          tr.docChanged
            ? syncDecorations(value, tr, newState.doc, skipDecorationsIn)
            : value,
      },
      props: {
        decorations: (state) => skipRenderKey.getState(state) ?? null,
      },
    }),
);
