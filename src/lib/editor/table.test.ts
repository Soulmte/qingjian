import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { caretCell, deleteTable, tableAround } from "@/lib/editor/table";

/** Only the node names and shape the table actions look at. */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    table: {
      content: "table_row+",
      group: "block",
      toDOM: () => ["table", 0],
    },
    table_row: { content: "table_cell+", toDOM: () => ["tr", 0] },
    table_cell: { content: "block+", toDOM: () => ["td", 0] },
    text: { group: "inline" },
  },
  marks: {},
});

function paragraph(text: string) {
  return schema.node("paragraph", null, text ? schema.text(text) : undefined);
}

/** A one-cell table. Content starts at 0; the cell's paragraph text sits at 4. */
function table() {
  const cell = schema.node("table_cell", null, [paragraph("单元格")]);
  return schema.node("table", null, [schema.node("table_row", null, [cell])]);
}

function stateOf(children: ReturnType<typeof paragraph>[]) {
  return EditorState.create({ schema, doc: schema.node("doc", null, children) });
}

/** A `rows` × `cols` table whose cells hold their coordinates; caret in one. */
function grid(rows: number, cols: number, target: { row: number; col: number }) {
  const body = [];
  for (let row = 0; row < rows; row += 1) {
    const cells = [];
    for (let col = 0; col < cols; col += 1) {
      cells.push(schema.node("table_cell", null, [paragraph(`${row}-${col}`)]));
    }
    body.push(schema.node("table_row", null, cells));
  }

  const doc = schema.node("doc", null, [schema.node("table", null, body)]);
  let caret = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.textContent === `${target.row}-${target.col}`) {
      caret = pos + 1;
    }
    return true;
  });

  return { doc, caret };
}

describe("caretCell", () => {
  it("reports the row and column the caret is on", () => {
    const { doc, caret } = grid(3, 3, { row: 1, col: 2 });
    const state = EditorState.create({ schema, doc });
    const inside = state.apply(state.tr.setSelection(TextSelection.create(doc, caret)));

    expect(caretCell(inside)).toEqual({ row: 1, col: 2, rows: 3, cols: 3 });
  });

  it("counts from zero, header row included", () => {
    const { doc, caret } = grid(2, 2, { row: 0, col: 0 });
    const state = EditorState.create({ schema, doc });
    const inside = state.apply(state.tr.setSelection(TextSelection.create(doc, caret)));

    expect(caretCell(inside)).toEqual({ row: 0, col: 0, rows: 2, cols: 2 });
  });

  it("reports nothing outside a table", () => {
    const state = EditorState.create({ schema, doc: schema.node("doc", null, [paragraph("正文")]) });
    const outside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

    expect(caretCell(outside)).toBeNull();
  });
});

describe("tableAround", () => {
  it("finds the table the caret sits in", () => {
    const state = stateOf([table()]);
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));

    expect(tableAround(inside)?.pos).toBe(0);
    expect(tableAround(inside)?.node.type.name).toBe("table");
  });

  it("reports nothing outside a table", () => {
    const state = stateOf([paragraph("正文")]);
    const outside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

    expect(tableAround(outside)).toBeNull();
  });
});

describe("deleteTable", () => {
  it("removes the table and keeps the blocks around it", () => {
    const state = stateOf([paragraph("前言"), table(), paragraph("后记")]);
    // The table starts after 前言; its first cell's text sits 4 further in.
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8)));

    const next = inside.apply(deleteTable(inside)!);

    expect(next.doc.childCount).toBe(2);
    expect(next.doc.textContent).toBe("前言后记");
  });

  it("leaves an empty paragraph when the table was the whole document", () => {
    const state = stateOf([table()]);
    const inside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));

    const next = inside.apply(deleteTable(inside)!);

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("reports nothing to do outside a table", () => {
    const state = stateOf([paragraph("正文")]);
    const outside = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

    expect(deleteTable(outside)).toBeNull();
  });
});
