import { describe, expect, it } from "vitest";

import { normaliseTableBreaks } from "@/lib/editor/table-markdown";

describe("normaliseTableBreaks", () => {
  it("empties a cell that held only a break", () => {
    const input = "| 甲 | 乙 |\n| - | - |\n| 1 | <br /> |\n";

    expect(normaliseTableBreaks(input)).toBe("| 甲 | 乙 |\n| - | - |\n| 1 | |\n");
  });

  it("handles the other spellings of the tag", () => {
    for (const tag of ["<br>", "<br/>", "<br  />", "<BR />"]) {
      expect(normaliseTableBreaks(`| a | ${tag} |`), tag).toBe("| a | |");
    }
  });

  it("empties neighbours in one pass", () => {
    // A single regex over the line would consume the shared pipe and miss the
    // second cell, which is exactly what a row appended through the table menu
    // produces.
    expect(normaliseTableBreaks("| <br /> | <br /> |")).toBe("| | |");
  });

  it("leaves a cell that really holds text and a break alone", () => {
    const input = "| 第一行<br />第二行 |";
    expect(normaliseTableBreaks(input)).toBe(input);
  });

  it("leaves a code span that shows the tag alone", () => {
    const input = "| `<br />` |";
    expect(normaliseTableBreaks(input)).toBe(input);
  });

  it("keeps an escaped pipe inside its cell", () => {
    // `\|` is a literal pipe; splitting on it would turn one cell into two.
    const input = "| a \\| b | <br /> |";
    expect(normaliseTableBreaks(input)).toBe("| a \\| b | |");
  });

  it("does not touch prose that mentions the tag", () => {
    const input = "这一行提到 <br /> 这个标签。\n\n| a | b |";
    expect(normaliseTableBreaks(input)).toBe(input);
  });

  it("returns the document untouched when the tag is absent", () => {
    const input = "# 标题\n\n正文\n\n| a | b |\n| - | - |\n";
    expect(normaliseTableBreaks(input)).toBe(input);
  });
});
