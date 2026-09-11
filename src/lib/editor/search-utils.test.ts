import { describe, expect, it } from "vitest";

import { centredScrollTop, findInSegments, isComfortablyVisible, wrapIndex } from "./search-utils";

const segments = [
  { text: "青简 Markdown", start: 0 },
  { text: "查找与替换", start: 20 },
  { text: "另一种 查找 方式", start: 40 },
];

describe("findInSegments", () => {
  it("finds every occurrence inside a segment", () => {
    expect(findInSegments([{ text: "abab", start: 10 }], "ab", true)).toEqual([
      { from: 10, to: 12 },
      { from: 12, to: 14 },
    ]);
  });

  it("reports offsets relative to each segment's start", () => {
    const matches = findInSegments(segments, "查找", true);
    expect(matches).toEqual([
      { from: 20, to: 22 },
      // "另一种 查找 方式" — 查 is the fifth character of the segment.
      { from: 44, to: 46 },
    ]);
  });

  it("never lets a match straddle two segments", () => {
    const split = [
      { text: "ab", start: 0 },
      { text: "cd", start: 5 },
    ];
    expect(findInSegments(split, "bc", true)).toEqual([]);
  });

  it("honours the case-sensitivity flag", () => {
    const latin = [{ text: "Markdown markdown", start: 0 }];
    expect(findInSegments(latin, "markdown", false)).toHaveLength(2);
    expect(findInSegments(latin, "markdown", true)).toEqual([{ from: 9, to: 17 }]);
  });

  it("returns nothing for an empty query", () => {
    expect(findInSegments(segments, "", false)).toEqual([]);
  });

  it("falls back to case-sensitive matching when lowering changes length", () => {
    // "İ".toLowerCase() is two code units, so offsets after it would shift.
    const tricky = [{ text: "İstanbul", start: 0 }];
    expect(findInSegments(tricky, "İstanbul", false)).toEqual([{ from: 0, to: 8 }]);
    // The query still matches the untouched text.
    expect(findInSegments(tricky, "istanbul", false)).toEqual([]);
  });
});

describe("wrapIndex", () => {
  it("cycles forwards and backwards", () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(4, 3)).toBe(1);
  });

  it("is safe with no matches", () => {
    expect(wrapIndex(5, 0)).toBe(0);
    expect(wrapIndex(-2, 0)).toBe(0);
  });
});

describe("isComfortablyVisible", () => {
  // A 600px-tall viewport starting 200px down the screen, with a 48px margin.
  const boxTop = 200;
  const boxBottom = 800;
  const margin = 48;

  it("accepts a match with room to spare on both sides", () => {
    expect(isComfortablyVisible(260, 280, boxTop, boxBottom, margin)).toBe(true);
  });

  it("rejects a match below the fold", () => {
    expect(isComfortablyVisible(900, 920, boxTop, boxBottom, margin)).toBe(false);
  });

  it("rejects a match above the fold", () => {
    expect(isComfortablyVisible(100, 120, boxTop, boxBottom, margin)).toBe(false);
  });

  it("rejects a match that is on screen but touching the margin", () => {
    // Stepping through neighbouring matches should not make the page creep.
    expect(isComfortablyVisible(210, 230, boxTop, boxBottom, margin)).toBe(false);
    expect(isComfortablyVisible(790, 810, boxTop, boxBottom, margin)).toBe(false);
  });
});

describe("centredScrollTop", () => {
  it("centres the match in the container", () => {
    // A 600px container at scrollTop 0, its top at 200, the match at 500.
    // The match starts 300px into the container; a 600px box centres it at
    // 300 - (600 - 20) / 2 = 10.
    expect(centredScrollTop(0, 500, 200, 600, 20)).toBe(10);
  });

  it("accounts for the scroll already applied", () => {
    expect(centredScrollTop(1000, 500, 200, 600, 20)).toBe(1010);
  });

  it("never scrolls above the top", () => {
    // A match near the top of a long document would otherwise want a negative
    // offset, which the browser would clamp anyway.
    expect(centredScrollTop(0, 210, 200, 600, 20)).toBe(0);
  });
});
