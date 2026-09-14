import { describe, expect, it } from "vitest";

import { sameDocument } from "@/lib/editor/same-document";

describe("sameDocument", () => {
  it("treats identical text as the same document", () => {
    expect(sameDocument("# 标题\n\n正文。\n", "# 标题\n\n正文。\n")).toBe(true);
  });

  it("accepts the ways Milkdown rewrites a thematic break", () => {
    // 这条是最初逼出这个函数的那一种：`---` 回来是 `***`。
    expect(sameDocument("# 标题\n\n---\n\n正文。\n", "# 标题\n\n***\n\n正文。\n")).toBe(true);
  });

  it("accepts the other marker spellings", () => {
    expect(sameDocument("* 一\n* 二\n", "- 一\n- 二\n")).toBe(true);
    expect(sameDocument("_斜体_ 与 __加粗__\n", "*斜体* 与 **加粗**\n")).toBe(true);
  });

  it("accepts a table that was padded on one side only", () => {
    const padded = "| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n";
    const minimal = "| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n";

    expect(sameDocument(padded, minimal)).toBe(true);
  });

  it("accepts a difference that only lives in the YAML block", () => {
    // 编辑器根本看不到那段，所以它不该被算成文档变了。
    expect(sameDocument("---\ntitle: 甲\n---\n\n正文。\n", "---\ntitle: 乙\n---\n\n正文。\n")).toBe(
      true,
    );
  });

  it("sees a real edit", () => {
    expect(sameDocument("# 标题\n\n正文。\n", "# 标题\n\n正文改过了。\n")).toBe(false);
    expect(sameDocument("# 标题\n", "# 标题\n\n多了一段。\n")).toBe(false);
    expect(sameDocument("正文。\n", "正文！\n")).toBe(false);
  });

  it("sees a change of block type", () => {
    // 都是“标记”，但不是同一种块。
    expect(sameDocument("- 一项\n", "# 一项\n")).toBe(false);
  });
});
