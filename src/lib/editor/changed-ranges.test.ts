import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { describe, expect, it } from "vitest";

import {
  blockRange,
  changedRanges,
  forEachBlockIn,
  mergeRanges,
  syncDecorations,
} from "@/lib/editor/changed-ranges";

/**
 * A stand-in for the editor's schema, holding only what the incremental machinery
 * looks at: top-level blocks with text in them. This runs headlessly, with no
 * editor and no DOM — the real one needs a webview.
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    blockquote: { content: "block+", group: "block", toDOM: () => ["blockquote", 0] },
    text: { group: "inline" },
  },
  marks: {},
});

function paragraph(text: string): PmNode {
  return schema.node("paragraph", null, text ? schema.text(text) : undefined);
}

function stateOf(...children: PmNode[]) {
  return EditorState.create({ schema, doc: schema.node("doc", null, children) });
}

describe("mergeRanges", () => {
  it("leaves a single range alone", () => {
    expect(mergeRanges([{ from: 3, to: 9 }])).toEqual([{ from: 3, to: 9 }]);
  });

  it("sorts and coalesces overlapping ranges", () => {
    expect(
      mergeRanges([
        { from: 20, to: 30 },
        { from: 0, to: 10 },
        { from: 5, to: 25 },
      ]),
    ).toEqual([{ from: 0, to: 30 }]);
  });

  it("joins ranges that merely touch", () => {
    expect(
      mergeRanges([
        { from: 0, to: 5 },
        { from: 5, to: 8 },
      ]),
    ).toEqual([{ from: 0, to: 8 }]);
  });

  it("keeps disjoint ranges apart", () => {
    expect(
      mergeRanges([
        { from: 10, to: 12 },
        { from: 0, to: 5 },
      ]),
    ).toEqual([
      { from: 0, to: 5 },
      { from: 10, to: 12 },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [
      { from: 5, to: 9 },
      { from: 0, to: 6 },
    ];
    mergeRanges(input);
    expect(input[0]).toEqual({ from: 5, to: 9 });
  });
});

describe("changedRanges", () => {
  it("reports the span an insertion produced", () => {
    const state = stateOf(paragraph("abc"));
    const tr = state.tr.insertText("XY", 2);

    // "abc" -> "aXYbc": positions 2..4 in the new document hold the insertion.
    expect(changedRanges(tr)).toEqual([{ from: 2, to: 4 }]);
  });

  it("reports a collapsed span for a deletion", () => {
    const state = stateOf(paragraph("abcdef"));
    const tr = state.tr.delete(2, 5);

    const ranges = changedRanges(tr);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(2);
    // Nothing replaced the removed text, so the new span is empty.
    expect(ranges[0].to).toBe(2);
  });

  it("reports positions in the final document when steps compound", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"));
    // Two edits in one transaction: the later step shifts what the earlier one
    // reported, so the first range has to come back re-mapped.
    const tr = state.tr.insertText("!", 2).insertText("?", 8);

    const ranges = changedRanges(tr);
    expect(ranges).toEqual([
      { from: 2, to: 3 },
      { from: 8, to: 9 },
    ]);
    expect(tr.doc.firstChild?.textContent).toBe("a!bc");
    expect(tr.doc.lastChild?.textContent).toBe("d?ef");
  });

  it("reports nothing for a transaction that changed no text", () => {
    const state = stateOf(paragraph("abc"));
    expect(changedRanges(state.tr)).toEqual([]);
  });
});

describe("blockRange", () => {
  it("widens a position inside a block to the whole block", () => {
    const doc = stateOf(paragraph("abc"), paragraph("def")).doc;
    // Position 6 is inside the second paragraph, which spans 5..10.
    expect(blockRange(doc, { from: 6, to: 6 })).toEqual({ from: 5, to: 10 });
  });

  it("covers every block a range spans", () => {
    const doc = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi")).doc;
    expect(blockRange(doc, { from: 2, to: 7 })).toEqual({ from: 0, to: 10 });
  });

  it("widens a boundary position to the block starting there", () => {
    const doc = stateOf(paragraph("abc"), paragraph("def")).doc;
    // Position 5 is the boundary itself, at depth 0. Left alone it would name no
    // block and rebuild nothing — which is how a block the caret had just left
    // kept its stale class.
    expect(blockRange(doc, { from: 5, to: 5 })).toEqual({ from: 5, to: 10 });
  });

  it("leaves a position at the very end of the document alone", () => {
    const doc = stateOf(paragraph("abc")).doc;
    const end = doc.content.size;
    // There is no block after it to widen to.
    expect(blockRange(doc, { from: end, to: end })).toEqual({ from: end, to: end });
  });

  it("clamps a range past the end of the document", () => {
    const doc = stateOf(paragraph("abc")).doc;
    const range = blockRange(doc, { from: 0, to: 9999 });
    expect(range.from).toBe(0);
    expect(range.to).toBeLessThanOrEqual(doc.content.size);
  });

  it("reaches the outer block for a position nested deeper", () => {
    const quote = schema.node("blockquote", null, [paragraph("引用")]);
    const doc = stateOf(quote).doc;
    // The caret sits inside the paragraph inside the quote; the top-level block
    // is the quote, so that is what has to be rebuilt.
    expect(blockRange(doc, { from: 2, to: 2 })).toEqual({ from: 0, to: doc.content.size });
  });
});

describe("forEachBlockIn", () => {
  const doc = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi")).doc;

  const visited = (from: number, to: number) => {
    const seen: string[] = [];
    forEachBlockIn(doc, from, to, (node) => seen.push(node.textContent));
    return seen;
  };

  it("visits every block for the whole document", () => {
    expect(visited(0, doc.content.size)).toEqual(["abc", "def", "ghi"]);
  });

  it("visits only the blocks a range overlaps", () => {
    // 5..10 is the second paragraph exactly.
    expect(visited(5, 10)).toEqual(["def"]);
  });

  it("visits both blocks a range straddles", () => {
    expect(visited(4, 6)).toEqual(["abc", "def"]);
  });

  it("does not descend into a block's children", () => {
    const nested = stateOf(schema.node("blockquote", null, [paragraph("引用")])).doc;
    const names: string[] = [];
    forEachBlockIn(nested, 0, nested.content.size, (node) => names.push(node.type.name));
    expect(names).toEqual(["blockquote"]);
  });
});

describe("syncDecorations", () => {
  /**
   * A builder that tags each block with its own text, so a decoration that was
   * carried across a stale document is visible as a mismatched class rather than
   * merely a wrong position.
   */
  const build = (doc: PmNode, from: number, to: number) => {
    const decorations: Decoration[] = [];
    forEachBlockIn(doc, from, to, (node, pos) => {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { class: node.textContent || "empty" }),
      );
    });
    return decorations;
  };

  const full = (doc: PmNode) => DecorationSet.create(doc, build(doc, 0, doc.content.size));

  /** Every decoration as `from:to:class`, in document order. */
  const describeSet = (set: DecorationSet, doc: PmNode) =>
    set
      .find(0, doc.content.size)
      .map((d) => {
        // `Decoration.node`'s third argument is the attrs, which live on the
        // decoration's (internal) type — `spec` is the fourth and is unused here.
        const { attrs } = (d as unknown as { type: { attrs: { class: string } } }).type;
        return `${d.from}:${d.to}:${attrs.class}`;
      })
      .sort();

  it("matches a full rebuild after typing into one block", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));
    const tr = state.tr.insertText("X", 7);

    const incremental = syncDecorations(full(state.doc), tr, tr.doc, build);
    expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full(tr.doc), tr.doc));
  });

  it("matches a full rebuild after inserting a whole block", () => {
    const state = stateOf(paragraph("abc"), paragraph("ghi"));
    const tr = state.tr.insert(5, paragraph("def"));

    const incremental = syncDecorations(full(state.doc), tr, tr.doc, build);
    expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full(tr.doc), tr.doc));
    // The new block really is covered, not merely absent from both sides.
    expect(describeSet(incremental, tr.doc)).toContain("5:10:def");
  });

  it("matches a full rebuild after deleting a block", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));
    const tr = state.tr.delete(5, 10);

    const incremental = syncDecorations(full(state.doc), tr, tr.doc, build);
    expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full(tr.doc), tr.doc));
  });

  it("matches a full rebuild after splitting a block", () => {
    const state = stateOf(paragraph("abcdef"));
    const tr = state.tr.split(4);

    const incremental = syncDecorations(full(state.doc), tr, tr.doc, build);
    expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full(tr.doc), tr.doc));
  });

  it("matches a full rebuild after two edits in one transaction", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));
    const tr = state.tr.insertText("!", 2).insertText("?", 8);

    const incremental = syncDecorations(full(state.doc), tr, tr.doc, build);
    expect(describeSet(incremental, tr.doc)).toEqual(describeSet(full(tr.doc), tr.doc));
  });

  it("rebuilds only the block the edit fell inside", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));

    const seen: string[] = [];
    const counting = (doc: PmNode, from: number, to: number) => {
      forEachBlockIn(doc, from, to, (node) => seen.push(node.textContent));
      return build(doc, from, to);
    };

    const tr = state.tr.insertText("X", 7);
    syncDecorations(full(state.doc), tr, tr.doc, counting);

    // The whole point: the other two paragraphs are never looked at again.
    expect(seen).toEqual(["dXef"]);
  });

  it("does not duplicate a decoration when a neighbour is swept into the range", () => {
    const state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));
    // An edit exactly on a block boundary makes `find` report both neighbours.
    const tr = state.tr.insert(5, paragraph("new"));

    const set = syncDecorations(full(state.doc), tr, tr.doc, build);
    const described = describeSet(set, tr.doc);

    expect(new Set(described).size).toBe(described.length);
    expect(described).toEqual(describeSet(full(tr.doc), tr.doc));
  });

  it("survives a run of edits without drifting from a full rebuild", () => {
    let state = stateOf(paragraph("abc"), paragraph("def"), paragraph("ghi"));
    let set = full(state.doc);

    for (const at of [2, 9, 4, 1, 12]) {
      const tr = state.tr.insertText("z", Math.min(at, state.doc.content.size - 1));
      set = syncDecorations(set, tr, tr.doc, build);
      state = state.apply(tr);
    }

    expect(describeSet(set, state.doc)).toEqual(describeSet(full(state.doc), state.doc));
  });
});
