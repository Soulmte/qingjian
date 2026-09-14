import { describe, expect, it } from "vitest";

import { flattenTree, virtualWindow } from "@/lib/virtual-list";

interface Node {
  path: string;
  isDir: boolean;
  children: Node[];
}

function dir(path: string, children: Node[] = []): Node {
  return { path, isDir: true, children };
}

function file(path: string): Node {
  return { path, isDir: false, children: [] };
}

describe("flattenTree", () => {
  const tree = [
    dir("a", [file("a/1.md"), dir("a/b", [file("a/b/2.md")])]),
    file("top.md"),
  ];

  it("walks in the order the rows appear on screen", () => {
    expect(flattenTree(tree, new Set()).map((row) => row.node.path)).toEqual([
      "a",
      "a/1.md",
      "a/b",
      "a/b/2.md",
      "top.md",
    ]);
  });

  it("reports the depth of each row", () => {
    expect(flattenTree(tree, new Set()).map((row) => row.depth)).toEqual([0, 1, 1, 2, 0]);
  });

  it("skips the whole subtree of a collapsed folder", () => {
    expect(flattenTree(tree, new Set(["a"])).map((row) => row.node.path)).toEqual(["a", "top.md"]);
  });

  it("skips a nested folder independently of its parent", () => {
    expect(flattenTree(tree, new Set(["a/b"])).map((row) => row.node.path)).toEqual([
      "a",
      "a/1.md",
      "a/b",
      "top.md",
    ]);
  });

  it("leaves a file with children-shaped data alone", () => {
    // Files never have children, but nothing here should assume that.
    const odd = [file("x.md")];
    expect(flattenTree(odd, new Set(["x.md"])).map((row) => row.node.path)).toEqual(["x.md"]);
  });
});

describe("virtualWindow", () => {
  const base = { count: 1000, rowHeight: 32, viewportHeight: 800, overscan: 8 };

  it("starts at zero when nothing has been scrolled", () => {
    const range = virtualWindow({ ...base, scrollTop: 0 });

    expect(range.start).toBe(0);
    // 25 rows fit, plus an overscan band on both sides and one for the edge.
    expect(range.end).toBe(42);
    expect(range.offsetY).toBe(0);
    expect(range.totalHeight).toBe(32_000);
  });

  it("follows the scroll position", () => {
    const range = virtualWindow({ ...base, scrollTop: 3200 });

    // Row 100 is at the top; the window backs off by the overscan.
    expect(range.start).toBe(92);
    expect(range.offsetY).toBe(92 * 32);
  });

  it("renders to the end of a short list without leaving a gap", () => {
    // 40 rows of 32px are 1280px of content, so the deepest the scroller can go
    // with an 800px viewport is 480.
    const range = virtualWindow({ ...base, count: 40, scrollTop: 480 });

    expect(range.start).toBe(7);
    expect(range.end).toBe(40);
  });

  it("renders nothing for an empty list", () => {
    expect(virtualWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      offsetY: 0,
      totalHeight: 0,
    });
  });

  it("keeps a visible band when the viewport has not been measured yet", () => {
    // A hidden container measures 0; rendering nothing there looks like a bug.
    const range = virtualWindow({ ...base, viewportHeight: 0, scrollTop: 0 });

    expect(range.end).toBeGreaterThan(0);
  });

  it("counts the container padding into the offsets", () => {
    const range = virtualWindow({ ...base, scrollTop: 0, paddingY: 4, count: 3 });

    expect(range.offsetY).toBe(4);
    expect(range.totalHeight).toBe(3 * 32 + 8);
    expect(range.start).toBe(0);
    expect(range.end).toBe(3);
  });

  it("does not go negative when scrolled into the padding", () => {
    const range = virtualWindow({ ...base, scrollTop: 2, paddingY: 4 });

    expect(range.start).toBe(0);
    // The padding is part of the offset, so the first row still starts below it.
    expect(range.offsetY).toBe(4);
  });

  it("survives a zero row height instead of dividing by it", () => {
    const range = virtualWindow({ ...base, scrollTop: 0, rowHeight: 0 });

    expect(range).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });
});
