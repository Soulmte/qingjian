/**
 * The alignment decorations, and their incremental rebuild.
 *
 * The plugin used to walk the whole document on every keystroke; it now rebuilds
 * only the blocks an edit fell inside (see `changed-ranges`). The classes are what
 * the stylesheet turns into a layout, so a block left with a stale one is a
 * visible bug rather than a slow path.
 */

import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import { describe, expect, it } from "vitest";

import { alignDecorationsIn, buildAlignDecorations } from "@/lib/editor/align-plugin";
import { syncDecorations } from "@/lib/editor/changed-ranges";

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
      attrs: { src: { default: "" } },
      toDOM: () => ["img", {}],
    },
    text: { group: "inline" },
  },
  marks: {},
});

const paragraph = (text: string, align = "left") =>
  schema.node("paragraph", { align }, text ? schema.text(text) : undefined);

function stateOf(...children: PmNode[]) {
  return EditorState.create({ schema, doc: schema.node("doc", null, children) });
}

function describeSet(set: DecorationSet, state: EditorState): string[] {
  return set
    .find(0, state.doc.content.size)
    .map((d) => {
      const { attrs } = (d as unknown as { type: { attrs: { class: string } } }).type;
      return `${d.from}:${attrs.class}`;
    })
    .sort();
}

describe("alignDecorationsIn", () => {
  it("tags each block with the side it carries", () => {
    const state = stateOf(paragraph("左"), paragraph("中", "center"), paragraph("右", "right"));

    expect(describeSet(buildAlignDecorations(state), state)).toEqual([
      "0:qj-align--left",
      "3:qj-align--center",
      "6:qj-align--right",
    ]);
  });

  it("reads an image's side out of its URL fragment", () => {
    const state = stateOf(schema.node("image-block", { src: "a.png#qj-align=right" }));
    expect(describeSet(buildAlignDecorations(state), state)).toEqual(["0:qj-align--right"]);
  });

  it("skips a block that has no side of its own", () => {
    // A quote is not alignable — the marker comment would land inside it.
    const state = stateOf(schema.node("blockquote", null, [paragraph("引用")]));
    expect(describeSet(buildAlignDecorations(state), state)).toEqual([]);
  });

  it("does not descend into a quote to tag the paragraph inside it", () => {
    const quote = schema.node("blockquote", null, [paragraph("引用", "center")]);
    const state = stateOf(quote);
    // The nested paragraph is deliberately not alignable, so tagging it would
    // centre text the user cannot control from the toolbar.
    expect(describeSet(buildAlignDecorations(state), state)).toEqual([]);
  });

  it("covers only the blocks a range overlaps", () => {
    const state = stateOf(paragraph("一"), paragraph("二", "center"), paragraph("三"));
    const decorations = alignDecorationsIn(state.doc, 3, 6);

    expect(decorations).toHaveLength(1);
    expect(decorations[0].from).toBe(3);
  });
});

describe("the incremental rebuild", () => {
  const full = (state: EditorState) => buildAlignDecorations(state);

  it("matches a full rebuild after typing into an aligned block", () => {
    const state = stateOf(paragraph("一"), paragraph("二", "center"), paragraph("三", "right"));
    const tr = state.tr.insertText("字", 4);
    const next = state.apply(tr);

    const incremental = syncDecorations(full(state), tr, next.doc, alignDecorationsIn);
    expect(describeSet(incremental, next)).toEqual(describeSet(full(next), next));
    // The centred block keeps its class rather than falling back to the default.
    expect(describeSet(incremental, next)).toContain("3:qj-align--center");
  });

  it("matches a full rebuild after an aligned block is inserted", () => {
    const state = stateOf(paragraph("一"), paragraph("三"));
    const tr = state.tr.insert(3, paragraph("二", "right"));
    const next = state.apply(tr);

    const incremental = syncDecorations(full(state), tr, next.doc, alignDecorationsIn);
    expect(describeSet(incremental, next)).toEqual(describeSet(full(next), next));
    expect(describeSet(incremental, next)).toContain("3:qj-align--right");
  });

  it("matches a full rebuild after an aligned block is deleted", () => {
    const state = stateOf(paragraph("一"), paragraph("二", "center"), paragraph("三"));
    const tr = state.tr.delete(3, 6);
    const next = state.apply(tr);

    const incremental = syncDecorations(full(state), tr, next.doc, alignDecorationsIn);
    expect(describeSet(incremental, next)).toEqual(describeSet(full(next), next));
  });

  it("follows the attribute when a block is realigned", () => {
    const state = stateOf(paragraph("一"), paragraph("二"));
    const tr = state.tr.setNodeMarkup(3, undefined, { align: "center" });
    const next = state.apply(tr);

    const incremental = syncDecorations(full(state), tr, next.doc, alignDecorationsIn);
    expect(describeSet(incremental, next)).toEqual(describeSet(full(next), next));
    expect(describeSet(incremental, next)).toContain("3:qj-align--center");
  });

  it("does not drift from a full rebuild over a run of edits", () => {
    let state = stateOf(paragraph("一"), paragraph("二", "center"), paragraph("三", "right"));
    let set = full(state);

    for (const at of [1, 4, 7, 2]) {
      const tr = state.tr.insertText("字", Math.min(at, state.doc.content.size - 1));
      const next = state.apply(tr);
      set = syncDecorations(set, tr, next.doc, alignDecorationsIn);
      state = next;
      expect(describeSet(set, state)).toEqual(describeSet(full(state), state));
    }
  });
});
