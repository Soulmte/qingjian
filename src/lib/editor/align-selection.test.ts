import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { applyAlign, alignOfNode, selectedBlock } from "@/lib/editor/align-selection";

/**
 * A stand-in for the editor's schema, holding only what the selection logic
 * looks at: the node names and the `align` attribute. This runs headlessly, with
 * no editor and no DOM, which is the point — the real one needs a webview.
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
    blockquote: {
      content: "block+",
      group: "block",
      toDOM: () => ["blockquote", 0],
    },
    "image-block": {
      group: "block",
      atom: true,
      attrs: {
        src: { default: "" },
        caption: { default: "" },
        ratio: { default: 1 },
      },
      toDOM: () => ["img", {}],
    },
    text: { group: "inline" },
  },
  marks: {},
});

/** Builds a document whose children are the given nodes. */
function docOf(...children: PmNode[]) {
  return schema.node("doc", null, children);
}

function paragraph(text: string, align = "left"): PmNode {
  return schema.node("paragraph", { align }, text ? schema.text(text) : undefined);
}

function stateOf(doc: PmNode, selection?: (doc: PmNode) => TextSelection | NodeSelection) {
  const state = EditorState.create({ schema, doc });
  if (!selection) return state;
  return state.apply(state.tr.setSelection(selection(doc)));
}

describe("selectedBlock", () => {
  it("finds the paragraph under the caret", () => {
    const state = stateOf(docOf(paragraph("正文")), (doc) => TextSelection.create(doc, 1));
    const target = selectedBlock(state);

    expect(target?.pos).toBe(0);
    expect(target?.node.type.name).toBe("paragraph");
    expect(target?.align).toBe("left");
  });

  it("reports the alignment the paragraph already carries", () => {
    const state = stateOf(
      docOf(paragraph("标题", "center")),
      (doc) => TextSelection.create(doc, 1),
    );
    expect(selectedBlock(state)?.align).toBe("center");
  });

  it("resolves the block at the caret, not the first block", () => {
    const state = stateOf(
      docOf(paragraph("一"), paragraph("二", "right")),
      (doc) => TextSelection.create(doc, 4),
    );
    const target = selectedBlock(state);

    expect(target?.node.textContent).toBe("二");
    expect(target?.align).toBe("right");
  });

  it("finds a heading", () => {
    const heading = schema.node("heading", { level: 2, align: "right" }, schema.text("标题"));
    const state = stateOf(docOf(heading), (doc) => TextSelection.create(doc, 1));
    expect(selectedBlock(state)?.align).toBe("right");
  });

  it("finds a selected image and reads its URL fragment", () => {
    const image = schema.node("image-block", { src: "assets/a.png#qj-align=right" });
    const state = stateOf(docOf(image), (doc) => NodeSelection.create(doc, 0));
    const target = selectedBlock(state);

    expect(target?.node.type.name).toBe("image-block");
    expect(target?.align).toBe("right");
  });

  it("refuses a paragraph nested in a blockquote", () => {
    // The marker comment would be written inside the quote, where it reads back
    // differently — so this deliberately reports nothing to align.
    const quote = schema.node("blockquote", null, [paragraph("引用")]);
    const state = stateOf(docOf(quote), (doc) => TextSelection.create(doc, 2));

    expect(selectedBlock(state)).toBeNull();
  });
});

describe("applyAlign", () => {
  it("writes the attribute on the block under the caret", () => {
    const state = stateOf(docOf(paragraph("正文")), (doc) => TextSelection.create(doc, 1));
    const transaction = applyAlign(state, "center");

    expect(transaction).not.toBeNull();
    const next = state.apply(transaction!);
    expect(next.doc.firstChild?.attrs.align).toBe("center");
    // The document structure is untouched — only the attribute moved.
    expect(next.doc.firstChild?.textContent).toBe("正文");
  });

  it("reports nothing to do when the block already sits there", () => {
    const state = stateOf(docOf(paragraph("正文", "center")), (doc) =>
      TextSelection.create(doc, 1),
    );
    expect(applyAlign(state, "center")).toBeNull();
  });

  it("returns left to the default rather than a marker", () => {
    const state = stateOf(docOf(paragraph("正文", "right")), (doc) =>
      TextSelection.create(doc, 1),
    );
    const next = state.apply(applyAlign(state, "left")!);
    expect(next.doc.firstChild?.attrs.align).toBe("left");
  });

  it("moves an image by rewriting its URL fragment", () => {
    const image = schema.node("image-block", { src: "assets/a.png" });
    const state = stateOf(docOf(image), (doc) => NodeSelection.create(doc, 0));

    const next = state.apply(applyAlign(state, "right")!);
    expect(next.doc.firstChild?.attrs.src).toBe("assets/a.png#qj-align=right");

    const back = next.apply(applyAlign(next, "center")!);
    expect(back.doc.firstChild?.attrs.src).toBe("assets/a.png");
  });

  it("does nothing when the selection cannot be aligned", () => {
    const quote = schema.node("blockquote", null, [paragraph("引用")]);
    const state = stateOf(docOf(quote), (doc) => TextSelection.create(doc, 2));
    expect(applyAlign(state, "center")).toBeNull();
  });
});

describe("alignOfNode", () => {
  it("treats an unknown attribute as the default", () => {
    expect(alignOfNode(paragraph("x", "diagonal"))).toBe("left");
  });

  it("ignores a node it does not own", () => {
    expect(alignOfNode(schema.node("blockquote", null, [paragraph("x")]))).toBeNull();
  });
});
