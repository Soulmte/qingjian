import { describe, expect, it } from "vitest";

import {
  frontMatterKeys,
  frontMatterTitle,
  frontMatterValue,
  normalizeFrontMatter,
  parseFrontMatter,
  withFrontMatter,
} from "@/lib/front-matter";

const NOTE = ["---", "title: 毕业论文", "author: lq", "---", "", "# 第一章", "", "正文。", ""].join(
  "\n",
);

describe("parseFrontMatter", () => {
  it("lifts the block off the body", () => {
    const { raw, body } = parseFrontMatter(NOTE);

    expect(raw).toBe("---\ntitle: 毕业论文\nauthor: lq\n---\n");
    expect(body).toBe("# 第一章\n\n正文。\n");
  });

  it("round-trips a document byte for byte", () => {
    const { raw, body } = parseFrontMatter(NOTE);
    expect(withFrontMatter(raw, body)).toBe(NOTE);
  });

  it("treats a document without a block as all body", () => {
    const plain = "# 标题\n\n正文\n";
    expect(parseFrontMatter(plain)).toEqual({ raw: "", body: plain });
  });

  it("ignores a rule that is not on the first line", () => {
    // A `---` in the middle is a thematic break, and must stay one.
    const body = "# 标题\n\n---\n\n正文\n";
    expect(parseFrontMatter(body)).toEqual({ raw: "", body });
  });

  it("treats an unterminated block as ordinary text", () => {
    const text = "---\ntitle: 没有结束\n\n正文\n";
    expect(parseFrontMatter(text)).toEqual({ raw: "", body: text });
  });

  it("rejects a break followed by a paragraph and another break", () => {
    // Two thematic breaks with a heading between them are not metadata; reading
    // them as such would quietly swallow the heading.
    const text = "---\n\n# 第一章\n\n---\n\n正文\n";
    expect(parseFrontMatter(text)).toEqual({ raw: "", body: text });
  });

  it("stops at a blank line rather than scanning to the next fence", () => {
    const text = "---\ntitle: 甲\n\n# 第一章\n\n---\n";
    expect(parseFrontMatter(text)).toEqual({ raw: "", body: text });
  });

  it("accepts the `...` closing delimiter", () => {
    const { raw, body } = parseFrontMatter("---\ntitle: 甲\n...\n\n正文\n");
    expect(raw).toBe("---\ntitle: 甲\n...\n");
    expect(body).toBe("正文\n");
  });

  it("keeps an empty body empty when the metadata is put back", () => {
    const { raw, body } = parseFrontMatter("---\ntitle: 甲\n---\n");
    expect(body).toBe("");
    expect(withFrontMatter(raw, body)).toBe("---\ntitle: 甲\n---\n");
  });

  it("handles CRLF input", () => {
    const { raw, body } = parseFrontMatter("---\r\ntitle: 甲\r\n---\r\n\r\n正文\r\n");
    expect(raw).toBe("---\ntitle: 甲\n---\n");
    expect(body).toBe("正文\n");
  });
});

describe("withFrontMatter", () => {
  it("drops an empty block rather than writing a delimiter pair", () => {
    expect(withFrontMatter("", "# 标题\n")).toBe("# 标题\n");
    expect(withFrontMatter("   \n", "# 标题\n")).toBe("# 标题\n");
  });
});

describe("frontMatterValue", () => {
  const raw = '---\ntitle: "带引号的标题"\nsubtitle: 副标题\ndraft: false\n---\n';

  it("reads a quoted value without its quotes", () => {
    expect(frontMatterValue(raw, "title")).toBe("带引号的标题");
  });

  it("is case-insensitive and reads the last match", () => {
    expect(frontMatterValue(raw, "Subtitle")).toBe("副标题");
  });

  it("returns null for a missing key or an empty block", () => {
    expect(frontMatterValue(raw, "missing")).toBeNull();
    expect(frontMatterValue("", "title")).toBeNull();
  });

  it("does not mistake the closing delimiter for a key", () => {
    expect(frontMatterKeys(raw)).toEqual(["title", "subtitle", "draft"]);
  });
});

describe("normalizeFrontMatter", () => {
  it("wraps bare keys in delimiters", () => {
    expect(normalizeFrontMatter("title: 甲\ndate: 2026-01-02")).toBe(
      "---\ntitle: 甲\ndate: 2026-01-02\n---\n",
    );
  });

  it("closes a block that is missing its ending fence", () => {
    expect(normalizeFrontMatter("---\ntitle: 甲")).toBe("---\ntitle: 甲\n---\n");
  });

  it("keeps an already well-formed block", () => {
    expect(normalizeFrontMatter("---\ntitle: 甲\n---")).toBe("---\ntitle: 甲\n---\n");
  });

  it("returns nothing for a blank draft, so the block can be removed", () => {
    expect(normalizeFrontMatter("   \n")).toBe("");
  });
});

describe("frontMatterTitle", () => {
  it("prefers the metadata title", () => {
    expect(frontMatterTitle(NOTE)).toBe("毕业论文");
  });

  it("returns null when there is no title", () => {
    expect(frontMatterTitle("---\nauthor: lq\n---\n\n# 标题\n")).toBeNull();
    expect(frontMatterTitle("# 标题\n")).toBeNull();
  });
});
