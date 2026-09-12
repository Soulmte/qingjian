/**
 * Focus mode's incremental path.
 *
 * Moving the caret changes exactly two blocks — the one it left and the one it
 * arrived in — so those are the only ones rebuilt. Getting the "left behind" half
 * wrong would leave two blocks looking active at once, which is why the state is
 * checked against a full rebuild after every move.
 */

import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import { describe, expect, it } from "vitest";

import {
  activeBlockRange,
  buildFocusDecorations,
  initialFocusState,
  nextFocusState,
  type FocusState,
} from "@/lib/editor/focus-mode";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    blockquote: { content: "block+", group: "block", toDOM: () => ["blockquote", 0] },
    text: { group: "inline" },
  },
  marks: {},
});

const paragraph = (text: string) =>
  schema.node("paragraph", null, text ? schema.text(text) : undefined);

function stateOf(...children: PmNode[]) {
  return EditorState.create({ schema, doc: schema.node("doc", null, children) });
}

/** Every decoration as `from:class`, sorted — the shape a comparison needs. */
function describeSet(set: DecorationSet, state: EditorState): string[] {
  return set
    .find(0, state.doc.content.size)
    .map((d) => {
      const { attrs } = (d as unknown as { type: { attrs: { class: string } } }).type;
      return `${d.from}:${attrs.class}`;
    })
    .sort();
}

/** Moves the caret, carrying the focus state across incrementally. */
function moveTo(
  focus: FocusState,
  state: EditorState,
  pos: number,
): { focus: FocusState; state: EditorState } {
  const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
  const next = state.apply(tr);
  return { focus: nextFocusState(focus, tr, next), state: next };
}

const active = (focus: FocusState, state: EditorState) =>
  describeSet(focus.decorations, state).filter((entry) => entry.endsWith("qj-block--active"));

describe("activeBlockRange", () => {
  it("is the top-level block holding the caret", () => {
    // Each paragraph here is 3 wide: an opening token, one character, a closing
    // one. So the second block spans 3..6 and its text sits at 4.
    const state = stateOf(paragraph("一"), paragraph("二"));
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)));

    expect(activeBlockRange(moved)).toEqual({ from: 3, to: 6 });
  });

  it("reaches the outer block for a caret nested deeper", () => {
    const quote = schema.node("blockquote", null, [paragraph("引用")]);
    const state = stateOf(quote);
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));

    expect(activeBlockRange(moved)).toEqual({ from: 0, to: state.doc.content.size });
  });
});

describe("nextFocusState", () => {
  it("marks exactly one block active from the start", () => {
    const state = stateOf(paragraph("一"), paragraph("二"), paragraph("三"));
    const focus = initialFocusState(state);

    expect(active(focus, state)).toEqual(["0:qj-block--active"]);
  });

  it("matches a full rebuild after the caret moves", () => {
    let state = stateOf(paragraph("一"), paragraph("二"), paragraph("三"));
    let focus = initialFocusState(state);

    ({ focus, state } = moveTo(focus, state, 4));

    expect(describeSet(focus.decorations, state)).toEqual(
      describeSet(buildFocusDecorations(state), state),
    );
    expect(active(focus, state)).toEqual(["3:qj-block--active"]);
  });

  it("dims the block the caret left", () => {
    let state = stateOf(paragraph("一"), paragraph("二"));
    let focus = initialFocusState(state);
    expect(active(focus, state)).toEqual(["0:qj-block--active"]);

    ({ focus, state } = moveTo(focus, state, 4));

    // The whole risk of the incremental path: two blocks looking active at once.
    expect(active(focus, state)).toHaveLength(1);
    expect(describeSet(focus.decorations, state)).toContain("0:qj-block--dim");
  });

  it("does not drift from a full rebuild over a run of moves", () => {
    let state = stateOf(paragraph("一"), paragraph("二"), paragraph("三"), paragraph("四"));
    let focus = initialFocusState(state);

    for (const pos of [4, 1, 10, 7, 1]) {
      ({ focus, state } = moveTo(focus, state, pos));
      expect(describeSet(focus.decorations, state)).toEqual(
        describeSet(buildFocusDecorations(state), state),
      );
      expect(active(focus, state)).toHaveLength(1);
    }
  });

  it("matches a full rebuild after an edit", () => {
    const state = stateOf(paragraph("一"), paragraph("二"));
    const focus = initialFocusState(state);

    const tr = state.tr.insertText("字", 4);
    const next = state.apply(tr);
    const after = nextFocusState(focus, tr, next);

    expect(describeSet(after.decorations, next)).toEqual(
      describeSet(buildFocusDecorations(next), next),
    );
  });

  it("matches a full rebuild after a block is inserted", () => {
    const state = stateOf(paragraph("一"), paragraph("三"));
    const focus = initialFocusState(state);

    const tr = state.tr.insert(3, paragraph("二"));
    const next = state.apply(tr);
    const after = nextFocusState(focus, tr, next);

    expect(describeSet(after.decorations, next)).toEqual(
      describeSet(buildFocusDecorations(next), next),
    );
  });

  it("matches a full rebuild after the active block is deleted", () => {
    let state = stateOf(paragraph("一"), paragraph("二"), paragraph("三"));
    let focus = initialFocusState(state);
    ({ focus, state } = moveTo(focus, state, 4));

    const tr = state.tr.delete(3, 6);
    const next = state.apply(tr);
    const after = nextFocusState(focus, tr, next);

    expect(describeSet(after.decorations, next)).toEqual(
      describeSet(buildFocusDecorations(next), next),
    );
  });

  it("leaves the state alone when neither the doc nor the selection moved", () => {
    const state = stateOf(paragraph("一"));
    const focus = initialFocusState(state);

    // A transaction that changed nothing must not cost a rebuild.
    expect(nextFocusState(focus, state.tr, state)).toBe(focus);
  });

  it("covers every block, so none is left unstyled", () => {
    const state = stateOf(paragraph("一"), paragraph("二"), paragraph("三"));
    const focus = initialFocusState(state);

    expect(describeSet(focus.decorations, state)).toHaveLength(state.doc.childCount);
  });
});
