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

  it("runs an alignment row without throwing", () => {
    const host = hostOf(schema.node("doc", null, [paragraph("正文")]));
    const align = rowOf(buildEditorMenu(host), "menu.align");

    expect(() => align[1].run?.()).not.toThrow();
  });
});
