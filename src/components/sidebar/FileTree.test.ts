import { describe, expect, it } from "vitest";

import { buildTree, filterNotes } from "@/components/sidebar/FileTree";
import type { Note, SearchHit } from "@/types";

let nextId = 1;

function note(relPath: string): Note {
  return {
    id: nextId++,
    workspaceId: 1,
    relPath,
    title: relPath,
    contentHash: null,
    pinned: false,
    isDeleted: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function hit(noteId: number): SearchHit {
  return { noteId, workspaceId: 1, title: "", relPath: "", snippet: "" };
}

describe("buildTree", () => {
  it("hides folders that lead to no note", () => {
    // A workspace that is a code repository has far more folders than notes, and
    // in a list of Markdown files they are noise.
    const tree = buildTree(
      [note("docs/a.md")],
      ["docs", "src", "src/components", "src-tauri/icons"],
    );

    expect(tree.map((entry) => entry.name)).toEqual(["docs"]);
  });

  it("keeps a folder that only leads to a folder holding a note", () => {
    const tree = buildTree([note("docs/guide/a.md")], ["docs", "docs/guide"]);

    expect(tree.map((entry) => entry.name)).toEqual(["docs"]);
    expect(tree[0].children.map((entry) => entry.name)).toEqual(["guide"]);
  });

  it("reveals an empty folder only while it is exempt", () => {
    // What "新建文件夹" relies on: the folder has to stay on screen before there
    // is anything to put in it.
    const folders = ["docs"];

    expect(buildTree([], folders)).toEqual([]);
    expect(buildTree([], folders, new Set(["docs"])).map((entry) => entry.name)).toEqual([
      "docs",
    ]);
  });

  it("keeps the folder above an exempt one", () => {
    const tree = buildTree([], ["docs/guide"], new Set(["docs/guide"]));

    expect(tree.map((entry) => entry.name)).toEqual(["docs"]);
    expect(tree[0].children.map((entry) => entry.name)).toEqual(["guide"]);
  });

  it("does not duplicate a folder that a note path already implies", () => {
    const tree = buildTree([note("docs/a.md")], ["docs"]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("docs");
    expect(tree[0].children.map((entry) => entry.name)).toEqual(["a.md"]);
  });

  it("creates the missing parents of a nested folder", () => {
    const tree = buildTree([], ["docs/guide/deep"], new Set(["docs/guide/deep"]));

    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("guide");
    expect(tree[0].children[0].children[0].name).toBe("deep");
  });

  it("sorts folders before notes, each by name", () => {
    const tree = buildTree(
      [note("b.md"), note("a.md"), note("zeta/z.md"), note("alpha/a.md")],
      ["zeta", "alpha"],
    );

    expect(tree.map((entry) => entry.name)).toEqual(["alpha", "zeta", "a.md", "b.md"]);
  });
});

/**
 * How the search box narrows the tree.
 *
 * Filtering rather than replacing is the point: the folders the matches sit in
 * stay on screen, so a search tells you where a note lives as well as that it
 * matched.
 */
describe("filterNotes", () => {
  it("shows everything when nothing is being searched for", () => {
    const notes = [note("a.md"), note("b.md")];
    expect(filterNotes(notes, null)).toBe(notes);
  });

  it("narrows to the matched notes, in list order", () => {
    const notes = [note("a.md"), note("b.md"), note("c.md")];
    const [a, b] = notes;

    // Hits arrive in relevance order, the tree keeps its own.
    expect(filterNotes(notes, [hit(b.id), hit(a.id)]).map((item) => item.relPath)).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("returns nothing for a search that matched nothing", () => {
    // An empty array is a settled search, not "not searching": hence the empty
    // state rather than the whole tree.
    expect(filterNotes([note("a.md")], [])).toEqual([]);
  });
});
