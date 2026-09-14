import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { isMenuItem, menuItems, type ContextMenuEntry, type ContextMenuItem } from "@/lib/context-menu";
import { buildEditorMenu, type EditorMenuHost } from "@/lib/editor/editor-menu";

/**
 * The menu is built from real editor state, so this stands in for the schema the
 * editor installs. It exercises the same code the right-click handler runs —
 * which is the point: a throw in here is invisible until someone right-clicks.
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { align: { default: "left" } },
      toDOM: () => ["p", 0],
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 }, align: { default: "left" } },
      toDOM: () => ["h1", 0],
    },
    blockquote: { content: "block+", group: "block", toDOM: () => ["blockquote", 0] },
    // The table group in the menu is only reachable with these node names in the
    // schema, and `isInTable` keys off them.
    table: { content: "table_row+", group: "block", toDOM: () => ["table", 0] },
    table_row: { content: "table_cell+", toDOM: () => ["tr", 0] },
    table_cell: {
      content: "block+",
      attrs: { alignment: { default: null } },
      toDOM: () => ["td", 0],
    },
    "image-block": {
      group: "block",
      atom: true,
      attrs: { src: { default: "" }, caption: { default: "" }, ratio: { default: 1 } },
      toDOM: () => ["img", {}],
    },
    text: { group: "inline" },
  },
  marks: {},
});

function paragraph(text: string): PmNode {
  return schema.node("paragraph", null, schema.text(text));
}

/** A host stub: the real one is an `EditorView`, which needs a DOM. */
function hostOf(
  doc: PmNode,
  select?: (doc: PmNode) => TextSelection | NodeSelection,
): EditorMenuHost {
  const base = EditorState.create({ schema, doc });
  const state = select ? base.apply(base.tr.setSelection(select(doc))) : base;
  return { state, dispatch: () => undefined, focus: () => undefined };
}

function submenuOf(entries: ContextMenuEntry[], id: string) {
  const item = entries.find((entry) => isMenuItem(entry) && entry.id === id);
  return item && isMenuItem(item) ? item.submenu : undefined;
}

/** The segmented row inside a submenu (heading levels, alignment). */
function rowOf(entries: ContextMenuEntry[], submenuId: string): ContextMenuItem[] {
  const row = (submenuOf(entries, submenuId) ?? []).find((entry) => "row" in entry);
  return row && "row" in row ? row.row : [];
}

/** The caret inside the first block. */
const inFirstBlock = (doc: PmNode) => TextSelection.create(doc, 1);

/** A one-cell table, with the caret in that cell. Content starts at 4. */
function tableDoc(alignment: string | null = null): PmNode {
  const cell = schema.node("table_cell", { alignment }, [paragraph("单元格")]);
  return schema.node("doc", null, [
    schema.node("table", null, [schema.node("table_row", null, [cell])]),
  ]);
}

/**
 * A `rows` × `cols` table whose cells hold their own coordinates.
 *
 * The caret is found by walking the document for the wanted cell rather than by
 * adding up node sizes: the arithmetic is easy to get subtly wrong and says
 * nothing about what is being tested.
 */
function grid(rows: number, cols: number, target: { row: number; col: number }) {
  const body: PmNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    const cells: PmNode[] = [];
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

const inTableCell = (doc: PmNode) => TextSelection.create(doc, 4);

/** The block itself selected, which is how clicking an image behaves. */
const firstBlockSelected = (doc: PmNode) => NodeSelection.create(doc, 0);

describe("buildEditorMenu", () => {
  it("builds the full menu without an editor view", () => {
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));

    expect(entries.length).toBeGreaterThan(0);
    // Rows are the shape the arrow keys walk; a malformed entry would throw here.
    expect(menuItems(entries).length).toBeGreaterThan(0);
  });

  it("puts the long lists behind submenus", () => {
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));

    for (const id of ["menu.format", "menu.paragraph", "menu.align", "menu.insert"]) {
      expect(submenuOf(entries, id), `${id} 应当是一个二级菜单`).toBeDefined();
    }
  });

  it("fills each submenu with rows the panel can render", () => {
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));

    // A submenu parent carries no action of its own, so its children are the
    // only way the panel does anything — an empty list would render a blank box.
    expect(menuItems(submenuOf(entries, "menu.format")!)).toHaveLength(5);
    expect(menuItems(submenuOf(entries, "menu.paragraph")!)).toHaveLength(11);
    expect(menuItems(submenuOf(entries, "menu.insert")!)).toHaveLength(6);
  });

  it("offers alignment for a top-level paragraph", () => {
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));
    const align = rowOf(entries, "menu.align");

    expect(align.map((item) => item.disabled)).toEqual([false, false, false]);
  });

  it("disables alignment where the marker could not be read back", () => {
    const quote = schema.node("blockquote", null, [paragraph("引用")]);
    const entries = buildEditorMenu(
      hostOf(schema.node("doc", null, [quote]), (doc) => TextSelection.create(doc, 2)),
    );
    const align = rowOf(entries, "menu.align");

    expect(align.every((item) => item.disabled)).toBe(true);
  });

  it("marks the heading level the caret is in", () => {
    const heading = schema.node("heading", { level: 3, align: "left" }, schema.text("标题"));
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [heading]), inFirstBlock));
    const level = rowOf(entries, "menu.paragraph");

    // 正文 + H1…H6, with exactly one marked — without it the panel says nothing
    // about which level is in force.
    expect(level.map((item) => item.label)).toEqual([
      "正文",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    expect(level.filter((item) => item.selected).map((item) => item.label)).toEqual(["H3"]);
    expect(level.every((item) => !item.disabled)).toBe(true);
  });

  it("marks 正文 for a plain paragraph", () => {
    const entries = buildEditorMenu(
      hostOf(schema.node("doc", null, [paragraph("正文")]), inFirstBlock),
    );
    const level = rowOf(entries, "menu.paragraph");

    expect(level.filter((item) => item.selected).map((item) => item.label)).toEqual(["正文"]);
  });

  it("disables the level segments when the block is not text", () => {
    const image = schema.node("image-block", { src: "assets/a.png" });
    const entries = buildEditorMenu(
      hostOf(schema.node("doc", null, [image]), firstBlockSelected),
    );
    const level = rowOf(entries, "menu.paragraph");

    expect(level.every((item) => item.disabled)).toBe(true);
    expect(level.some((item) => item.selected)).toBe(false);
  });

  it("marks the alignment the block already has", () => {
    const centered = schema.node("paragraph", { align: "center" }, schema.text("居中"));
    const entries = buildEditorMenu(
      hostOf(schema.node("doc", null, [centered]), inFirstBlock),
    );
    const align = rowOf(entries, "menu.align");

    expect(align.filter((item) => item.selected).map((item) => item.label)).toEqual(["居中"]);
  });

  it("gives every actionable row something to do", () => {
    const entries = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));

    for (const item of menuItems(entries)) {
      if (item.submenu) {
        expect(item.run, `${item.id} 只开二级菜单，不应带动作`).toBeUndefined();
      } else {
        expect(typeof item.run, `${item.id} 没有动作`).toBe("function");
      }
    }
  });

  it("adds the image group only when an image is selected", () => {
    const plain = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));
    expect(submenuOf(plain, "menu.image")).toBeUndefined();
  });

  it("adds the table group only while the caret is in a table", () => {
    const plain = buildEditorMenu(hostOf(schema.node("doc", null, [paragraph("正文")])));
    expect(submenuOf(plain, "menu.table")).toBeUndefined();

    const inside = buildEditorMenu(hostOf(tableDoc(), inTableCell));
    const ids = menuItems(submenuOf(inside, "menu.table")!).map((item) => item.id);

    expect(ids).toEqual([
      "table.rowBefore",
      "table.rowAfter",
      "table.colBefore",
      "table.colAfter",
      "table.moveRowUp",
      "table.moveRowDown",
      "table.moveColLeft",
      "table.moveColRight",
      "table.deleteRow",
      "table.deleteCol",
      "table.delete",
    ]);
  });

  it("offers no move that would leave the table", () => {
    // One cell: there is neither another row nor another column to move into.
    const entries = buildEditorMenu(hostOf(tableDoc(), inTableCell));
    const moves = menuItems(submenuOf(entries, "menu.table")!).filter((item) =>
      item.id.startsWith("table.move"),
    );

    expect(moves.map((item) => item.disabled)).toEqual([true, true, true, true]);
  });

  it("enables the moves that have somewhere to go", () => {
    // Middle of a 3×3: every direction is available.
    const middle = grid(3, 3, { row: 1, col: 1 });
    const entries = buildEditorMenu(
      hostOf(middle.doc, (doc) => TextSelection.create(doc, middle.caret)),
    );
    const moves = menuItems(submenuOf(entries, "menu.table")!).filter((item) =>
      item.id.startsWith("table.move"),
    );

    expect(moves.map((item) => item.disabled)).toEqual([false, false, false, false]);
  });

  it("greys out only the moves the caret cannot make", () => {
    // Bottom-left corner: up and right are possible, down and left are not.
    const corner = grid(3, 3, { row: 2, col: 0 });
    const entries = buildEditorMenu(
      hostOf(corner.doc, (doc) => TextSelection.create(doc, corner.caret)),
    );
    const moves = menuItems(submenuOf(entries, "menu.table")!).filter((item) =>
      item.id.startsWith("table.move"),
    );

    expect(moves.map((item) => [item.id, item.disabled])).toEqual([
      ["table.moveRowUp", false],
      ["table.moveRowDown", true],
      ["table.moveColLeft", true],
      ["table.moveColRight", false],
    ]);
  });

  it("marks the column's alignment inside a table", () => {
    // Inside a table the alignment rows drive the column, so they stay usable and
    // report the cell's own alignment even though no block can be moved.
    const entries = buildEditorMenu(hostOf(tableDoc("right"), inTableCell));
    const align = rowOf(entries, "menu.align");

    expect(align.map((item) => item.disabled)).toEqual([false, false, false]);
    expect(align.filter((item) => item.selected).map((item) => item.label)).toEqual(["右对齐"]);
  });

  it("runs a table row without throwing", () => {
    const host = hostOf(tableDoc(), inTableCell);
    const items = menuItems(submenuOf(buildEditorMenu(host), "menu.table")!);

    for (const item of items) {
      expect(() => item.run?.(), `${item.id} 抛了`).not.toThrow();
    }
  });

  it("runs an alignment row without throwing", () => {
    const host = hostOf(schema.node("doc", null, [paragraph("正文")]));
    const align = rowOf(buildEditorMenu(host), "menu.align");

    expect(() => align[1].run?.()).not.toThrow();
  });
});
