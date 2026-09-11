import { describe, expect, it } from "vitest";

import { countCharacters, countWords, extractTitle, parseOutline } from "@/lib/markdown";

describe("extractTitle", () => {
  it("prefers the first heading", () => {
    expect(extractTitle("# 所有权\n\n正文", "fallback")).toBe("所有权");
    expect(extractTitle("没有标题\n第二行", "fallback")).toBe("没有标题");
    expect(extractTitle("\n\n   \n", "fallback")).toBe("fallback");
  });

  it("prefers the metadata title over the first heading", () => {
    const note = "---\ntitle: 毕业论文\nauthor: lq\n---\n\n# 第一章\n";
    expect(extractTitle(note, "fallback")).toBe("毕业论文");
  });

  it("falls back to the heading when the metadata has no title", () => {
    expect(extractTitle("---\nauthor: lq\n---\n\n# 第一章\n", "fallback")).toBe("第一章");
  });

  it("skips a rule or an alignment marker, which hold no words", () => {
    // Otherwise a note that opens with a horizontal rule would be named "---".
    expect(extractTitle("---\n\n# 第一章\n\n---\n\n正文\n", "fallback")).toBe("第一章");
    expect(extractTitle("<!-- qj-align:center -->\n\n正文\n", "fallback")).toBe("正文");
    expect(extractTitle("```\n```\n\n真正的标题\n", "fallback")).toBe("真正的标题");
  });
});

describe("countWords", () => {
  it("counts CJK characters and Latin words", () => {
    expect(countWords("中文 three words")).toBe(2 + 2);
  });

  it("does not count the metadata block as prose", () => {
    expect(countWords("---\ntitle: 毕业论文\nauthor: lq\n---\n\n正文\n")).toBe(2);
  });
});

describe("countCharacters", () => {
  it("counts every character, including whitespace and newlines", () => {
    expect(countCharacters("ab\n中")).toBe(4);
    expect(countCharacters("")).toBe(0);
  });

  it("counts a surrogate pair as one character", () => {
    // A lone emoji is two UTF-16 code units but one character to the reader.
    expect(countCharacters("\u{1f600}")).toBe(1);
    expect(countCharacters("a\u{1f600}b")).toBe(3);
    // A high surrogate with nothing after it is still one code unit.
    expect(countCharacters("\ud83d")).toBe(1);
  });
});

describe("parseOutline", () => {
  it("reads the headings and ignores the metadata block", () => {
    const note = "---\ntitle: 毕业论文\n---\n\n# 第一章\n\n## 1.1 小节\n";
    expect(parseOutline(note)).toEqual([
      { level: 1, text: "第一章", line: 4 },
      { level: 2, text: "1.1 小节", line: 6 },
    ]);
  });
});
