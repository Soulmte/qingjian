import { describe, expect, it } from "vitest";

import { fuzzyScore, rankByFuzzy } from "./fuzzy";

describe("fuzzyScore", () => {
  it("matches subsequences and rejects non-matches", () => {
    expect(fuzzyScore("查找替换", "查找")).not.toBeNull();
    expect(fuzzyScore("查找替换", "替换")).not.toBeNull();
    expect(fuzzyScore("查找替换", "公式")).toBeNull();
  });

  it("requires the characters in order", () => {
    expect(fuzzyScore("abc", "ac")).not.toBeNull();
    expect(fuzzyScore("abc", "ca")).toBeNull();
  });

  it("scores an empty query as a match", () => {
    expect(fuzzyScore("任意", "")).toBe(0);
  });

  it("prefers word starts over matches buried in a word", () => {
    const atStart = fuzzyScore("toggle outline", "tog");
    const inMiddle = fuzzyScore("autogenerate", "tog");
    expect(atStart).not.toBeNull();
    expect(inMiddle).not.toBeNull();
    expect(atStart as number).toBeGreaterThan(inMiddle as number);
  });

  it("prefers shorter candidates", () => {
    const short = fuzzyScore("查找", "查");
    const long = fuzzyScore("查找并替换全部内容", "查");
    expect(short as number).toBeGreaterThan(long as number);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("Markdown", "md")).not.toBeNull();
    expect(fuzzyScore("Markdown", "MD")).not.toBeNull();
  });
});

describe("rankByFuzzy", () => {
  it("drops non-matches and orders by score", () => {
    const items = ["查找并替换全部内容", "无关命令", "查找"];
    expect(rankByFuzzy(items, "查找", (item) => item)).toEqual(["查找", "查找并替换全部内容"]);
  });

  it("keeps the original order when scores tie", () => {
    const items = ["外观", "外表"];
    const ranked = rankByFuzzy(items, "外", (item) => item);
    expect(ranked).toEqual(["外观", "外表"]);
  });

  it("returns everything for an empty query", () => {
    expect(rankByFuzzy(["a", "b"], "", (item) => item)).toEqual(["a", "b"]);
  });
});
