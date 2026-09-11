import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "@/lib/export/ir";

describe("parseInline", () => {
  it("keeps plain text as one run", () => {
    expect(parseInline("普通文字")).toEqual([{ t: "text", v: "普通文字" }]);
  });

  it("recognises the emphasis the editor can produce", () => {
    expect(parseInline("a **粗** b")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", v: "粗" },
      { t: "text", v: " b" },
    ]);
    expect(parseInline("*斜*")).toEqual([{ t: "italic", v: "斜" }]);
    expect(parseInline("**粗**和*斜*")).toEqual([
      { t: "bold", v: "粗" },
      { t: "text", v: "和" },
      { t: "italic", v: "斜" },
    ]);
    expect(parseInline("~~删~~")).toEqual([{ t: "strike", v: "删" }]);
    expect(parseInline("`code`")).toEqual([{ t: "code", v: "code" }]);
  });

  it("reads links and images", () => {
    expect(parseInline("[名](https://e.test)")).toEqual([
      { t: "link", v: "名", href: "https://e.test" },
    ]);
    expect(parseInline("![替代](assets/a.png)")).toEqual([
      { t: "image", v: "替代", src: "assets/a.png" },
    ]);
  });

  it("strips the alignment fragment from an image path", () => {
    expect(parseInline("![](assets/a.png#qj-align=left)")).toEqual([
      { t: "image", v: "", src: "assets/a.png" },
    ]);
  });

  it("attaches a resolved file to an image", () => {
    const runs = parseInline("![](a.png)", {
      resolveImageFile: (src) => (src === "a.png" ? "/abs/a.png" : undefined),
    });
    expect(runs).toEqual([{ t: "image", v: "", src: "a.png", file: "/abs/a.png" }]);
  });

  it("leaves a marker with no matching close as literal text", () => {
    expect(parseInline("**未闭合")).toEqual([{ t: "text", v: "**未闭合" }]);
  });

  it("honours a backslash escape", () => {
    expect(parseInline("\\*不是斜体\\*")).toEqual([{ t: "text", v: "*不是斜体*" }]);
  });

  it("does not nest emphasis", () => {
    expect(parseInline("**粗 *内* 粗**")).toEqual([
      { t: "bold", v: "粗 *内* 粗" },
    ]);
  });

  it("reads inline maths and renders it to MathML", () => {
    const runs = parseInline("质能方程 $E = mc^2$ 很简洁");

    expect(runs.map((run) => run.t)).toEqual(["text", "math", "text"]);
    const formula = runs[1];
    if (formula.t !== "math") throw new Error("expected a formula");
    expect(formula.tex).toBe("E = mc^2");
    expect(formula.mathml).toContain("<math");
    expect(formula.mathml).toContain("</math>");
  });

  it("leaves currency alone", () => {
    // The rule that separates a formula from a price: the content may not begin
    // or end with a space, and it cannot cross another `$`.
    expect(parseInline("$5 和 $10")).toEqual([{ t: "text", v: "$5 和 $10" }]);
    expect(parseInline("$ 空格 $")).toEqual([{ t: "text", v: "$ 空格 $" }]);
    expect(parseInline("$$")).toEqual([{ t: "text", v: "$$" }]);
  });

  it("honours an escaped dollar sign", () => {
    expect(parseInline("\\$不走公式\\$")).toEqual([{ t: "text", v: "$不走公式$" }]);
  });

  it("keeps inline HTML as markup", () => {
    expect(parseInline("H<sub>2</sub>O")).toEqual([
      { t: "text", v: "H" },
      { t: "html", v: "<sub>" },
      { t: "text", v: "2" },
      { t: "html", v: "</sub>" },
      { t: "text", v: "O" },
    ]);

    expect(parseInline("按 <kbd>Ctrl</kbd> 保存")[1]).toEqual({ t: "html", v: "<kbd>" });
  });

  it("leaves markup outside the allowed set as text", () => {
    // A tag the editor does not treat as prose markup, and an attribute that
    // could carry a script, both stay literal.
    expect(parseInline("<div>块")).toEqual([{ t: "text", v: "<div>块" }]);
    expect(parseInline('<span style="color:red">红</span>')).toEqual([
      { t: "text", v: '<span style="color:red">红</span>' },
    ]);
    expect(parseInline("3 < 5")).toEqual([{ t: "text", v: "3 < 5" }]);
  });
});

describe("parseMarkdown blocks", () => {
  it("reads headings with their level", () => {
    expect(parseMarkdown("# 一\n\n### 三")).toEqual([
      { t: "heading", level: 1, align: "left", runs: [{ t: "text", v: "一" }] },
      { t: "heading", level: 3, align: "left", runs: [{ t: "text", v: "三" }] },
    ]);
  });

  it("joins wrapped lines into one paragraph", () => {
    expect(parseMarkdown("第一行\n第二行\n\n下段")).toEqual([
      { t: "paragraph", align: "left", runs: [{ t: "text", v: "第一行 第二行" }] },
      { t: "paragraph", align: "left", runs: [{ t: "text", v: "下段" }] },
    ]);
  });

  it("reads a fenced code block verbatim, including blank lines", () => {
    expect(parseMarkdown("```rust\nfn a() {}\n\nfn b() {}\n```")).toEqual([
      { t: "code", lang: "rust", text: "fn a() {}\n\nfn b() {}" },
    ]);
  });

  it("closes an unterminated fence at the end of the document", () => {
    expect(parseMarkdown("```\nabc")).toEqual([{ t: "code", lang: "", text: "abc" }]);
  });

  it("reads a horizontal rule", () => {
    expect(parseMarkdown("---")).toEqual([{ t: "hr" }]);
  });

  it("reads a quote by parsing its body recursively", () => {
    expect(parseMarkdown("> 引用\n> **粗**")).toEqual([
      {
        t: "quote",
        blocks: [
          {
            t: "paragraph",
            align: "left",
            runs: [
              { t: "text", v: "引用 " },
              { t: "bold", v: "粗" },
            ],
          },
        ],
      },
    ]);
  });

  it("nests lists by indentation", () => {
    const blocks = parseMarkdown("- 一\n  - 一点一\n- 二");
    expect(blocks).toEqual([
      {
        t: "list",
        ordered: false,
        items: [
          {
            blocks: [
              { t: "paragraph", align: "left", runs: [{ t: "text", v: "一" }] },
              {
                t: "list",
                ordered: false,
                items: [
                  {
                    blocks: [
                      { t: "paragraph", align: "left", runs: [{ t: "text", v: "一点一" }] },
                    ],
                  },
                ],
              },
            ],
          },
          { blocks: [{ t: "paragraph", align: "left", runs: [{ t: "text", v: "二" }] }] },
        ],
      },
    ]);
  });

  it("separates an ordered list from a bullet list that follows it", () => {
    const blocks = parseMarkdown("1. 甲\n2. 乙\n\n- 丙");
    expect(blocks.map((block) => (block.t === "list" ? block.ordered : null))).toEqual([true, false]);
  });

  it("reads a GFM table with per-column alignment", () => {
    const blocks = parseMarkdown("| 左 | 中 | 右 |\n| :- | :-: | -: |\n| a | b | c |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table.t !== "table") throw new Error("expected a table");
    expect(table.aligns).toEqual(["left", "center", "right"]);
    expect(table.head.map((cell) => cell[0])).toEqual([
      { t: "text", v: "左" },
      { t: "text", v: "中" },
      { t: "text", v: "右" },
    ]);
    expect(table.rows).toHaveLength(1);
  });

  it("does not mistake a pipe in prose for a table", () => {
    expect(parseMarkdown("a | b")[0].t).toBe("paragraph");
  });

  it("reads a lone image as an image block with its caption", () => {
    expect(parseMarkdown('![说明](assets/a.png "图注")')).toEqual([
      { t: "image", align: "center", src: "assets/a.png", caption: "图注" },
    ]);
  });

  it("reads the size the editor stored in the alt", () => {
    // `![0.44](a.png "说明")`: the number is the scale, the title is the caption.
    const blocks = parseMarkdown('![0.44](assets/p.png "说明")');

    expect(blocks[0]).toMatchObject({
      t: "image",
      src: "assets/p.png",
      caption: "说明",
      ratio: 0.44,
    });
  });

  it("leaves an image at its natural size without a numeric alt", () => {
    const blocks = parseMarkdown('![一张图](assets/p.png "说明")');
    expect(blocks[0]).toMatchObject({ t: "image", caption: "说明" });
    expect(blocks[0]).not.toHaveProperty("ratio");

    // Zero is what the loader reads as "natural", so it must not become a size.
    expect(parseMarkdown("![0.00](a.png)")[0]).not.toHaveProperty("ratio");
    // And a description that merely starts with a number is still a description.
    expect(parseMarkdown("![2 图](a.png)")[0]).not.toHaveProperty("ratio");
  });

  it("takes an image's alignment from its URL fragment", () => {
    expect(parseMarkdown("![](a.png#qj-align=right)")).toEqual([
      { t: "image", align: "right", src: "a.png", caption: "" },
    ]);
  });

  it("gives a marker comment to the block below it", () => {
    expect(parseMarkdown("<!-- qj-align:center -->\n居中文字")).toEqual([
      { t: "paragraph", align: "center", runs: [{ t: "text", v: "居中文字" }] },
    ]);
  });

  it("applies a marker to a heading too", () => {
    expect(parseMarkdown("<!-- qj-align:right -->\n## 标题")).toEqual([
      { t: "heading", level: 2, align: "right", runs: [{ t: "text", v: "标题" }] },
    ]);
  });

  it("ignores a marker with nothing under it", () => {
    expect(parseMarkdown("<!-- qj-align:center -->")).toEqual([]);
  });

  it("turns a lone <br /> into an empty paragraph, not literal text", () => {
    // Milkdown writes an empty paragraph as `<br />`; exporting the tag itself
    // would show up as visible text in the document.
    expect(parseMarkdown("<br />")).toEqual([{ t: "paragraph", align: "left", runs: [] }]);
  });

  it("accepts every spelling of the tag an editor may write", () => {
    for (const tag of ["<br>", "<br/>", "<br />", "<BR>", "<br  />"]) {
      expect(parseMarkdown(tag), tag).toEqual([{ t: "paragraph", align: "left", runs: [] }]);
    }
  });

  it("reads a <br /> in a quote as a blank line inside the quote", () => {
    expect(parseMarkdown("> <br />")).toEqual([
      { t: "quote", blocks: [{ t: "paragraph", align: "left", runs: [] }] },
    ]);
  });

  it("keeps a break that sits inside a paragraph", () => {
    expect(parseMarkdown("第一行<br />第二行")).toEqual([
      {
        t: "paragraph",
        align: "left",
        runs: [
          { t: "text", v: "第一行" },
          { t: "br" },
          { t: "text", v: "第二行" },
        ],
      },
    ]);
  });

  it("reads a trailing backslash or two trailing spaces as a hard break", () => {
    const expected = [
      {
        t: "paragraph",
        align: "left",
        runs: [
          { t: "text", v: "第一行" },
          { t: "br" },
          { t: "text", v: "第二行" },
        ],
      },
    ];
    expect(parseMarkdown("第一行\\\n第二行")).toEqual(expected);
    expect(parseMarkdown("第一行  \n第二行")).toEqual(expected);
  });

  it("reads a plain soft break as a space, not a break", () => {
    expect(parseMarkdown("第一行\n第二行")).toEqual([
      { t: "paragraph", align: "left", runs: [{ t: "text", v: "第一行 第二行" }] },
    ]);
  });

  it("reads task list checkboxes as state, not text", () => {
    expect(parseMarkdown("* [x] 完成\n* [ ] 待办")).toEqual([
      {
        t: "list",
        ordered: false,
        items: [
          {
            blocks: [{ t: "paragraph", align: "left", runs: [{ t: "text", v: "完成" }] }],
            checked: true,
          },
          {
            blocks: [{ t: "paragraph", align: "left", runs: [{ t: "text", v: "待办" }] }],
            checked: false,
          },
        ],
      },
    ]);
  });

  it("gives an empty task item no content rather than a stray blank line", () => {
    expect(parseMarkdown("- [ ] <br />")).toEqual([
      { t: "list", ordered: false, items: [{ blocks: [], checked: false }] },
    ]);
  });

  it("handles CRLF input", () => {
    expect(parseMarkdown("# 一\r\n\r\n正文\r\n")).toEqual([
      { t: "heading", level: 1, align: "left", runs: [{ t: "text", v: "一" }] },
      { t: "paragraph", align: "left", runs: [{ t: "text", v: "正文" }] },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
  });

  it("covers a document that uses everything at once", () => {
    const markdown = [
      "# 标题",
      "",
      "<!-- qj-align:center -->",
      "居中的段落，带 **粗体** 和 [链接](https://e.test)。",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
      "> 引用",
      "",
      "- 甲",
      "  - 甲一",
      "- 乙",
      "",
      "1. 一",
      "2. 二",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "---",
      "",
      "![图](assets/p.png \"说明\")",
    ].join("\n");

    const blocks = parseMarkdown(markdown);
    expect(blocks.map((block) => block.t)).toEqual([
      "heading",
      "paragraph",
      "code",
      "quote",
      "list",
      "list",
      "table",
      "hr",
      "image",
    ]);
    expect(blocks[1]).toMatchObject({ align: "center" });
    expect(blocks[8]).toMatchObject({ caption: "说明", src: "assets/p.png" });
  });

  it("nests an ordered list inside an ordered one", () => {
    const blocks = parseMarkdown(["1. 第一", "   1. 子一", "   2. 子二", "2. 第二", ""].join("\n"));

    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list.t).toBe("list");
    if (list.t !== "list") throw new Error("expected a list");

    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    // The nested list rides inside the first item's blocks, one level deeper, so
    // the renderers can number it after its parent.
    expect(list.items[0].blocks.map((block) => block.t)).toEqual(["paragraph", "list"]);
    const nested = list.items[0].blocks[1];
    if (nested.t !== "list") throw new Error("expected a nested list");
    expect(nested.ordered).toBe(true);
    expect(nested.items).toHaveLength(2);
  });

  it("treats a leading YAML block as metadata, not content", () => {
    const markdown = ["---", "title: 毕业论文", "author: lq", "---", "", "# 第一章", "", "正文", ""].join(
      "\n",
    );

    const blocks = parseMarkdown(markdown);

    // The delimiters must not become a rule, and the closing one must not turn
    // `author: lq` into a setext heading.
    expect(blocks.map((block) => block.t)).toEqual(["heading", "paragraph"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    const body = JSON.stringify(blocks);
    expect(body).not.toContain("---");
    expect(body).not.toContain("author");
  });

  it("keeps a rule that is not front matter", () => {
    const blocks = parseMarkdown("# 标题\n\n---\n\n正文\n");
    expect(blocks.map((block) => block.t)).toEqual(["heading", "hr", "paragraph"]);
  });

  it("reads a display formula between `$$` fences", () => {
    const blocks = parseMarkdown(
      ["$$", "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}", "$$", ""].join("\n"),
    );

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.t).toBe("mathBlock");
    if (block.t !== "mathBlock") throw new Error("expected a formula");

    expect(block.tex).toBe("\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}");
    // MathML, not the LaTeX source: an exported page has to draw it itself.
    expect(block.mathml).toContain("<math");
    expect(block.mathml).toContain("</math>");
    expect(block.mathml).not.toContain("$");
  });

  it("treats a `latex` fence as a display formula", () => {
    // This is how the editor itself stores a display formula.
    const blocks = parseMarkdown(["```latex", "E = mc^2", "```", ""].join("\n"));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: "mathBlock", tex: "E = mc^2" });
  });

  it("reads a formula that fits on one line", () => {
    expect(parseMarkdown("$$ a = b $$\n")[0]).toMatchObject({ t: "mathBlock", tex: "a = b" });
  });

  it("keeps an unparsable formula rather than dropping it", () => {
    const blocks = parseMarkdown(["$$", "\\frac{", "$$", ""].join("\n"));
    expect(blocks[0]).toMatchObject({ t: "mathBlock" });
    // Whatever KaTeX makes of it, the source has to survive to the other side.
    expect(JSON.stringify(blocks)).toContain("\\\\frac{");
  });
});
