import type { Node } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";

/**
 * Table actions that the menus drive.
 *
 * Inserting and deleting rows or columns is the GFM preset's own business — its
 * commands are called straight from the menu. Only the whole-table case is
 * written here: the preset has no command for it, and the two lines it takes are
 * better than another binding to keep in step.
 */

/** The table the selection sits in, if any, with the position of the node itself. */
export function tableAround(state: EditorState): { pos: number; node: Node } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") return { pos: $from.before(depth), node };
  }
  return null;
}

/**
 * Removes the whole table, or `null` when the selection is not in one.
 *
 * A document cannot be empty, so a paragraph takes the table's place when it was
 * the only block — otherwise deleting it would leave nothing to put the caret in.
 */
export function deleteTable(state: EditorState): Transaction | null {
  const table = tableAround(state);
  if (!table) return null;

  const tr = state.tr.delete(table.pos, table.pos + table.node.nodeSize);
  if (tr.doc.childCount > 0) return tr;

  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  return tr.insert(0, paragraph.create());
}

/** Where the caret sits inside its table. */
export interface CellPosition {
  /** Row index, counting the header row as 0. */
  row: number;
  /** Column index. */
  col: number;
  rows: number;
  cols: number;
}

/**
 * The row and column the caret is on, or `null` when it is not in a table.
 *
 * The list commands take indices, and the menu needs them to grey out "move up"
 * on the first row; the sizes come along so it can do the same at the other end.
 */
export function caretCell(state: EditorState): CellPosition | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const table = $from.node(depth);
    if (table.type.name !== "table") continue;

    // The caret is inside table > row > cell, so the row is the ancestor one
    // level in and the column is its index within that row. `depth + 1` is that
    // ancestor, and it always exists for a position inside a table.
    const rowDepth = depth + 1;
    if (rowDepth > $from.depth) return null;

    const row = $from.node(rowDepth);
    return {
      row: $from.index(depth),
      col: $from.index(rowDepth),
      rows: table.childCount,
      cols: row.childCount,
    };
  }
  return null;
}
