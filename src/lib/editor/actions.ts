import { setAlignCommand } from "@milkdown/kit/preset/gfm";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";

import { type Align } from "./align";
import { applyAlign, isInTable } from "./align-selection";
import { runEditorCommand } from "./bridge";

/**
 * Editor actions that ProseMirror expresses better than Markdown does.
 *
 * They take a view rather than a Milkdown `Ctx` so the same function can be
 * called from a keymap binding and from a toolbar button; the keymap wrapper in
 * `typora-keymap.ts` resolves the view and forwards to these.
 */

/**
 * The part of `EditorView` these actions actually drive.
 *
 * Narrower than the view so the menus, which receive an `EditorView` at runtime,
 * can be built and tested against a plain editor state; `EditorView` satisfies it
 * structurally.
 */
export interface EditableHost {
  state: EditorState;
  dispatch: (transaction: Transaction) => void;
}

/**
 * Aligns whatever the caret is in: a table column, or the block around it.
 *
 * Both meanings share one chord and one set of buttons, so the choice is made
 * here and nowhere else. A cell's paragraph is not a top-level block, so
 * `applyAlign` would find nothing to move inside a table — the column is what
 * the command means there, and the GFM preset owns that side of it.
 */
export function applyAlignment(view: EditableHost, align: Align): boolean {
  if (isInTable(view.state)) return runEditorCommand(setAlignCommand.key, align);

  const transaction = applyAlign(view.state, align);
  if (!transaction) return false;

  view.dispatch(transaction);
  return true;
}

/** The block the cursor sits in: a paragraph, heading, list item's text, … */
function currentBlock(view: EditableHost) {
  const { $from } = view.state.selection;
  const depth = $from.depth;
  if (depth < 1) return null;
  return {
    depth,
    from: $from.before(depth),
    to: $from.after(depth),
  };
}

/** Selects the whole block the cursor sits in (Typora's 选中当前行). */
export function selectLine(view: EditorView): boolean {
  const block = currentBlock(view);
  if (!block) return false;

  const { from, to } = block;
  if (to <= from) return false;

  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
  );
  return true;
}

/**
 * Removes the block the cursor sits in (Typora's 删除当前行).
 *
 * An emptied list item or block quote is dropped as well, which is what a
 * reader expects "delete this line" to do; otherwise a blank bullet is left
 * behind.
 */
export function deleteLine(view: EditorView): boolean {
  const block = currentBlock(view);
  if (!block) return false;

  const { state } = view;
  const tr = state.tr;
  tr.delete(block.from, block.to);

  // The position of the deleted block is now either inside its former parent or
  // at the end of the document; resolving it lets an emptied parent be removed.
  const $pos = tr.doc.resolve(Math.min(block.from, tr.doc.content.size));
  const parent = $pos.parent;
  const emptiable = parent.type.name === "list_item" || parent.type.name === "blockquote";
  if (emptiable && parent.content.size === 0 && $pos.depth > 0) {
    tr.delete($pos.before($pos.depth), $pos.after($pos.depth));
  }

  // Removing the last block would leave an empty document, which the schema
  // does not allow; an empty paragraph takes its place.
  if (tr.doc.childCount === 0) {
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;
    tr.insert(0, paragraph.create());
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Strips inline marks and turns the touched blocks back into plain paragraphs
 * (Typora's 清除格式).
 *
 * This is written against the transform API rather than the `prosemirror-commands`
 * helpers, because the version Milkdown pins does not export `clearNodes` or
 * `unsetAllMarks`. List and block-quote nesting is deliberately left alone —
 * that is structure, not formatting, and the slash menu is how it is changed.
 */
export function clearFormatting(view: EditableHost): boolean {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const tr = state.tr;

  if (empty) {
    // Nothing selected: the marks applied to the next typed character are what
    // "formatting" means at the cursor.
    tr.setStoredMarks([]);
  } else {
    for (const mark of Object.values(state.schema.marks)) {
      tr.removeMark(from, to, mark);
    }
  }

  const paragraph = state.schema.nodes.paragraph;
  if (paragraph) {
    // `setBlockType` only visits nodes inside the range, so an empty selection
    // has to be widened to the block it sits in.
    const block = empty ? currentBlock(view) : null;
    const range = block ? { from: block.from, to: block.to } : { from, to };
    if (range.to > range.from) tr.setBlockType(range.from, range.to, paragraph);
  }

  view.dispatch(tr);
  return true;
}
