/**
 * The incremental half of in-document find.
 *
 * The plugin no longer re-scans the whole document on every keystroke: matches
 * are carried across a transaction by `tr.mapping` and only the edited spans are
 * searched again. That is a correctness risk as much as a speed win, so almost
 * every test here checks the incremental result against what a full re-scan would
 * have produced.
 *
 * `nextSearchState` is driven directly rather than through an editor: `$prose`
 * hands its plugin to Milkdown's container instead of returning it, and the real
 * editor needs a webview.
 */

import { Schema, type Node as PmNode } from "@milkdown/kit/prose/model";
import { EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import {
  collectSegments,
  IDLE,
  nextSearchState,
  searchKey,
  type SearchState,
} from "@/lib/editor/search";
import { findInSegments, type SearchMatch } from "@/lib/editor/search-utils";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
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

/** Starts a search, the way the find bar's `setSearchQuery` does. */
function find(state: EditorState, query: string, caseSensitive = false): SearchState {
  return nextSearchState(
    IDLE,
    state.tr.setMeta(searchKey, { type: "set", query, caseSensitive }),
  );
}

/** Applies an edit, carrying the search state across it incrementally. */
function edit(
  search: SearchState,
  state: EditorState,
  change: (tr: Transaction) => Transaction,
): { search: SearchState; state: EditorState } {
  const tr = change(state.tr);
  return { search: nextSearchState(search, tr), state: state.apply(tr) };
}

/** What a from-scratch scan of the document would report. */
function rescan(state: EditorState, search: SearchState): SearchMatch[] {
  return findInSegments(collectSegments(state.doc), search.query, search.caseSensitive);
}

/** The text each match actually covers — what a highlight would show. */
function covered(search: SearchState, state: EditorState): string[] {
  return search.matches.map((m) => state.doc.textBetween(m.from, m.to));
}

describe("starting a search", () => {
  it("finds every occurrence across blocks", () => {
    const state = stateOf(paragraph("找到我"), paragraph("再找到我"));
    const search = find(state, "找到");

    expect(search.matches).toEqual(rescan(state, search));
    expect(covered(search, state)).toEqual(["找到", "找到"]);
    expect(search.index).toBe(0);
  });

  it("reports nothing for an empty query", () => {
    const state = stateOf(paragraph("abc"));
    expect(find(state, "").matches).toEqual([]);
  });

  it("honours the case-sensitivity flag", () => {
    const state = stateOf(paragraph("Markdown markdown"));
    expect(find(state, "markdown", false).matches).toHaveLength(2);
    expect(find(state, "markdown", true).matches).toHaveLength(1);
  });
});

describe("carrying matches across an edit", () => {
  it("shifts the matches below an insertion", () => {
    let state = stateOf(paragraph("aa"), paragraph("需要找到"));
    let search = find(state, "找到");
    const before = search.matches[0];

    ({ search, state } = edit(search, state, (tr) => tr.insertText("XX", 1)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(search.matches[0].from).toBe(before.from + 2);
    expect(covered(search, state)).toEqual(["找到"]);
  });

  it("finds a match the edit itself created", () => {
    let state = stateOf(paragraph("abc"));
    let search = find(state, "找到");
    expect(search.matches).toEqual([]);

    ({ search, state } = edit(search, state, (tr) => tr.insertText("找到", 2)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(covered(search, state)).toEqual(["找到"]);
  });

  it("finds a match formed across the edit's boundary", () => {
    // The query straddles the insertion point: "找" and "到" were already there,
    // so neither the old matches nor the inserted text alone would report it.
    let state = stateOf(paragraph("找到"));
    let search = find(state, "找XX到");
    expect(search.matches).toEqual([]);

    ({ search, state } = edit(search, state, (tr) => tr.insertText("XX", 2)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(covered(search, state)).toEqual(["找XX到"]);
  });

  it("drops a match the edit broke apart", () => {
    let state = stateOf(paragraph("找到"));
    let search = find(state, "找到");
    expect(search.matches).toHaveLength(1);

    ({ search, state } = edit(search, state, (tr) => tr.insertText("X", 2)));

    expect(search.matches).toEqual([]);
    expect(search.matches).toEqual(rescan(state, search));
  });

  it("drops a match the edit deleted", () => {
    let state = stateOf(paragraph("找到我"), paragraph("找到你"));
    let search = find(state, "找到");
    expect(search.matches).toHaveLength(2);

    // Removes the first paragraph's text entirely.
    ({ search, state } = edit(search, state, (tr) => tr.delete(1, 4)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(covered(search, state)).toEqual(["找到"]);
  });

  it("never reports the same match twice", () => {
    let state = stateOf(paragraph("找到"), paragraph("找到"));
    let search = find(state, "找到");

    // An edit right on the block boundary is where a re-scanned span and a
    // carried-across match are most likely to both claim the same range.
    ({ search, state } = edit(search, state, (tr) => tr.insert(4, paragraph("找到"))));

    const keys = search.matches.map((m) => `${m.from}:${m.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(search.matches).toEqual(rescan(state, search));
  });

  it("keeps the matches in document order", () => {
    let state = stateOf(paragraph("找到 a"), paragraph("b 找到"));
    let search = find(state, "找到");

    ({ search, state } = edit(search, state, (tr) => tr.insertText("找到", 1)));

    expect(search.matches).toEqual(rescan(state, search));
    const froms = search.matches.map((m) => m.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });

  it("handles two edits in one transaction", () => {
    let state = stateOf(paragraph("找到 aa"), paragraph("bb 找到"));
    let search = find(state, "找到");

    ({ search, state } = edit(search, state, (tr) => tr.insertText("X", 5).insertText("Y", 10)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(covered(search, state)).toEqual(["找到", "找到"]);
  });

  it("does not drift from a full re-scan over a run of edits", () => {
    let state = stateOf(paragraph("找到 一"), paragraph("找到 二"), paragraph("三"));
    let search = find(state, "找到");

    for (const at of [1, 6, 3, 11, 2]) {
      const target = Math.min(at, state.doc.content.size - 1);
      ({ search, state } = edit(search, state, (tr) => tr.insertText("字", target)));
      expect(search.matches).toEqual(rescan(state, search));
    }
  });

  it("leaves the state alone when nothing is being searched for", () => {
    const state = stateOf(paragraph("abc"));
    const tr = state.tr.insertText("X", 2);
    // The find bar is closed, so the edit must not even look at the document.
    expect(nextSearchState(IDLE, tr)).toBe(IDLE);
  });
});

describe("the current match across an edit", () => {
  it("stays on the same match when the edit is above it", () => {
    let state = stateOf(paragraph("找到 一"), paragraph("找到 二"));
    let search = find(state, "找到");
    search = nextSearchState(search, state.tr.setMeta(searchKey, { type: "step", delta: 1 }));
    expect(search.index).toBe(1);

    // Typing in the first paragraph must not send the counter back to 1 / 2.
    ({ search, state } = edit(search, state, (tr) => tr.insertText("X", 1)));

    expect(search.index).toBe(1);
    expect(search.matches[search.index].from).toBeGreaterThan(search.matches[0].from);
  });

  it("moves to the next match down when the current one is deleted", () => {
    let state = stateOf(paragraph("找到 一"), paragraph("找到 二"));
    let search = find(state, "找到");
    expect(search.index).toBe(0);

    // Removes the first paragraph's own match.
    ({ search, state } = edit(search, state, (tr) => tr.delete(1, 3)));

    expect(search.matches).toEqual(rescan(state, search));
    expect(search.matches).toHaveLength(1);
    // The surviving match is the one that was second; the index follows it
    // rather than jumping anywhere else.
    expect(search.index).toBe(0);
  });

  it("keeps the index inside the list when every match goes away", () => {
    let state = stateOf(paragraph("找到"));
    let search = find(state, "找到");

    ({ search, state } = edit(search, state, (tr) => tr.delete(1, 3)));

    expect(search.matches).toEqual([]);
    expect(search.index).toBe(0);
  });
});

describe("the highlights", () => {
  it("are built alongside the matches, not on every redraw", () => {
    const state = stateOf(paragraph("找到 一"), paragraph("找到 二"));
    const search = find(state, "找到");

    // One decoration per match, and the current one marked.
    const decorations = search.decorations.find(0, state.doc.content.size);
    expect(decorations).toHaveLength(2);
    expect(decorations.map((d) => d.from)).toEqual(search.matches.map((m) => m.from));
  });

  it("are empty when nothing matches", () => {
    const state = stateOf(paragraph("abc"));
    const search = find(state, "找到");
    expect(search.decorations.find(0, state.doc.content.size)).toEqual([]);
  });
});
