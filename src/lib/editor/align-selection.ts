import type { Node } from "@milkdown/kit/prose/model";
import {
  NodeSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";

import { isAlign, type Align } from "./align";
import { alignmentOf, withAlignment } from "./image-align";

/** Node name Crepe's image feature registers. */
export const IMAGE_BLOCK = "image-block";

/** Blocks the alignment commands act on, besides images. */
const TEXT_BLOCKS = new Set(["paragraph", "heading"]);

export interface AlignTarget {
  pos: number;
  node: Node;
  align: Align;
}

/** The alignment a node carries, or `null` when it is not an alignable block. */
export function alignOfNode(node: Node): Align | null {
  if (node.type.name === IMAGE_BLOCK) return alignmentOf(node.attrs.src as string);
  if (TEXT_BLOCKS.has(node.type.name)) {
    return isAlign(node.attrs.align) ? node.attrs.align : "left";
  }
  return null;
}

/**
 * Only blocks directly under the document are offered.
 *
 * The text marker is written on a line of its own, which a list item or a
 * blockquote would reinterpret — turning a tight list loose, for instance. A
 * paragraph inside one is therefore reported as "nothing to align" rather than
 * silently producing Markdown that reads back differently.
 */
function topLevelTarget(
  state: EditorState,
  pos: number,
  node: Node,
): AlignTarget | null {
  if (state.doc.resolve(pos).parent.type.name !== "doc") return null;
  const align = alignOfNode(node);
  return align ? { pos, node, align } : null;
}

/**
 * The image or text block the selection refers to, if any.
 *
 * Kept free of any Milkdown plugin imports so it can be exercised against a
 * plain ProseMirror schema in a test — this is the piece that decides whether
 * the alignment buttons are usable at all.
 */
export function selectedBlock(state: EditorState): AlignTarget | null {
  const { selection } = state;

  // A selected image is an atom: `$from` sits *before* it, at depth 0, so the
  // node has to be taken from the selection itself.
  const direct = (selection as NodeSelection).node;
  if (direct) {
    const found = topLevelTarget(state, selection.from, direct);
    if (found) return found;
  }

  const { $from } = selection;
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth);
    if (!alignOfNode(node)) continue;
    return topLevelTarget(state, $from.before(depth), node);
  }

  return null;
}

/** Moves the selected block, or `null` when there is nothing to change. */
export function applyAlign(state: EditorState, align: Align): Transaction | null {
  const target = selectedBlock(state);
  if (!target) return null;

  const { pos, node } = target;

  if (node.type.name === IMAGE_BLOCK) {
    const src = node.attrs.src as string;
    const next = withAlignment(src, align);
    if (next === src) return null;
    return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
  }

  if (node.attrs.align === align) return null;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
}
