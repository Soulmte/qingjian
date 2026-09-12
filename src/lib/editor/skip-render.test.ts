/**
 * Which blocks are safe to leave unrendered.
 *
 * This is the decision that replaced demoting a long note to a textarea, and
 * getting it wrong is not a performance bug but a visual one: `content-visibility`
 * turns on paint containment, so a block that draws outside its own box — a table
 * handle, a code-block language picker, an inline LaTeX editor — would be clipped.
 * The rule therefore has to stay conservative, and these tests are what pins it.
 */

import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import {
  buildSkipDecorations,
  isContainableBlock,
  SKIP_RENDER_CLASS,
} from "@/lib/editor/skip-render";

/**
 * The node types the real editor has, reduced to what the rule reads: the type
 * name, and whether the subtree holds a non-text inline node.
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
      toDOM: () => ["h1", 0],
    },
    blockquote: { content: "block+", group: "block", toDOM: () => ["blockquote", 0] },
    bullet_list: { content: "list_item+", group: "block", toDOM: () => ["ul", 0] },
    list_item: { content: "paragraph+", toDOM: () => ["li", 0] },
    code_block: { content: "text*", group: "block", code: true, toDOM: () => ["pre", 0] },
    table: { content: "paragraph+", group: "block", toDOM: () => ["table", 0] },
    hr: { group: "block", toDOM: () => ["hr"] },
    // Crepe's image block is an atom sitting at block level.
    "image-block": {
      group: "block",
      atom: true,
      attrs: { src: { default: "" } },
      toDOM: () => ["img", {}],
    },
    // An inline image or LaTeX span: the kind of node that brings its own
    // editing affordance drawn over the line.
    inline_latex: { group: "inline", inline: true, atom: true, toDOM: () => ["span"] },
    text: { group: "inline" },
  },
  marks: {},
});

const node = (name: string, content?: PmNode[] | PmNode) =>
  schema.node(name, null, content);
const paragraph = (text: string) => node("paragraph", text ? schema.text(text) : undefined);

describe("isContainableBlock", () => {
  it("accepts an ordinary paragraph", () => {
    expect(isContainableBlock(paragraph("正文"))).toBe(true);
  });

  it("accepts an empty paragraph", () => {
    expect(isContainableBlock(paragraph(""))).toBe(true);
  });

  it("accepts a blockquote and a list", () => {
    expect(isContainableBlock(node("blockquote", [paragraph("引用")]))).toBe(true);
    expect(
      isContainableBlock(node("bullet_list", [node("list_item", [paragraph("一")])])),
    ).toBe(true);
  });

  it("accepts a horizontal rule", () => {
    expect(isContainableBlock(node("hr"))).toBe(true);
  });

  it("refuses a heading, which the outline scrolls to", () => {
    expect(isContainableBlock(schema.node("heading", { level: 2 }, schema.text("标题")))).toBe(
      false,
    );
  });

  it("refuses a code block, whose language picker floats outside it", () => {
    expect(isContainableBlock(node("code_block", schema.text("const x = 1")))).toBe(false);
  });

  it("refuses a table, whose row and column handles float outside it", () => {
    expect(isContainableBlock(node("table", [paragraph("单元格")]))).toBe(false);
  });

  it("refuses an image block", () => {
    expect(isContainableBlock(schema.node("image-block", { src: "a.png" }))).toBe(false);
  });

  it("refuses a paragraph holding an inline atom", () => {
    // The inline LaTeX editor is drawn over the line the span sits on, so paint
    // containment on the paragraph would cut it off.
    const withLatex = schema.node("paragraph", null, [
      schema.text("公式 "),
      node("inline_latex"),
      schema.text(" 后面"),
    ]);
    expect(isContainableBlock(withLatex)).toBe(false);
  });

  it("refuses a blockquote that holds one further down", () => {
    const quote = node("blockquote", [
      paragraph("正常"),
      schema.node("paragraph", null, [node("inline_latex")]),
    ]);
    expect(isContainableBlock(quote)).toBe(false);
  });
});

describe("buildSkipDecorations", () => {
  const decorated = (...children: PmNode[]) => {
    const state = EditorState.create({ schema, doc: schema.node("doc", null, children) });
    const set = buildSkipDecorations(state);
    return set.find(0, state.doc.content.size).map((d) => d.from);
  };

  it("marks every containable block and nothing else", () => {
    const froms = decorated(
      paragraph("一"),
      node("code_block", schema.text("x")),
      paragraph("二"),
    );

    // Positions 0 and 6: the two paragraphs. The code block at 3 is skipped.
    expect(froms).toEqual([0, 6]);
  });

  it("marks nothing in a document made only of unsafe blocks", () => {
    expect(decorated(node("table", [paragraph("单元格")]))).toEqual([]);
  });

  it("uses the class the stylesheet acts on", () => {
    const state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [paragraph("正文")]),
    });
    const [decoration] = buildSkipDecorations(state).find(0, state.doc.content.size);
    const { attrs } = (decoration as unknown as { type: { attrs: { class: string } } }).type;

    expect(attrs.class).toBe(SKIP_RENDER_CLASS);
  });

  it("does not mark a nested paragraph separately from its quote", () => {
    // Only top-level blocks carry the mark: containing an inner paragraph as well
    // would nest containment for no further saving.
    expect(decorated(node("blockquote", [paragraph("引用")]))).toEqual([0]);
  });
});
