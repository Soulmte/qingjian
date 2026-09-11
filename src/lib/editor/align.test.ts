import { describe, expect, it } from "vitest";

import {
  alignClass,
  alignMarker,
  applyAlignMarkers,
  isAlign,
  parseAlignMarker,
  type MarkerNode,
} from "@/lib/editor/align";

const paragraph = (value: string): MarkerNode => ({
  type: "paragraph",
  children: [{ type: "text", value }],
});

describe("alignMarker / parseAlignMarker", () => {
  it("round-trips every side", () => {
    for (const align of ["left", "center", "right"] as const) {
      expect(parseAlignMarker(alignMarker(align))).toBe(align);
    }
  });

  it("only accepts a marker on its own", () => {
    expect(parseAlignMarker("<!-- qj-align:center -->")).toBe("center");
    expect(parseAlignMarker("  <!--qj-align:right-->  ")).toBe("right");
    expect(parseAlignMarker("<!-- qj-align:diagonal -->")).toBeNull();
    expect(parseAlignMarker("<!-- other -->")).toBeNull();
    expect(parseAlignMarker("<!-- qj-align:center -->文字")).toBeNull();
    expect(parseAlignMarker(undefined)).toBeNull();
    expect(parseAlignMarker("")).toBeNull();
  });
});

describe("applyAlignMarkers", () => {
  it("moves the alignment onto the following block and drops the marker", () => {
    const tree: MarkerNode = {
      type: "root",
      children: [
        { type: "html", value: "<!-- qj-align:center -->" },
        paragraph("居中"),
      ],
    };

    applyAlignMarkers(tree);

    expect(tree.children).toHaveLength(1);
    expect(tree.children![0].type).toBe("paragraph");
    expect(tree.children![0].qjAlign).toBe("center");
  });

  it("walks into nested content, so a centred quote still works", () => {
    const tree: MarkerNode = {
      type: "root",
      children: [
        {
          type: "blockquote",
          children: [
            { type: "html", value: "<!-- qj-align:right -->" },
            paragraph("引用"),
          ],
        },
      ],
    };

    applyAlignMarkers(tree);

    expect(tree.children![0].children).toHaveLength(1);
    expect(tree.children![0].children![0].qjAlign).toBe("right");
  });

  it("handles several markers in one pass", () => {
    const tree: MarkerNode = {
      type: "root",
      children: [
        { type: "html", value: "<!-- qj-align:center -->" },
        paragraph("一"),
        { type: "html", value: "<!-- qj-align:right -->" },
        paragraph("二"),
      ],
    };

    applyAlignMarkers(tree);

    expect(tree.children!.map((child) => child.qjAlign ?? null)).toEqual(["center", "right"]);
  });

  it("keeps an unrelated comment and a trailing marker", () => {
    const tree: MarkerNode = {
      type: "root",
      children: [
        { type: "html", value: "<!-- 备注 -->" },
        paragraph("正文"),
        { type: "html", value: "<!-- qj-align:center -->" },
      ],
    };

    applyAlignMarkers(tree);

    expect(tree.children).toHaveLength(3);
    expect(tree.children![1].qjAlign).toBeUndefined();
  });

  it("ignores a node without children", () => {
    expect(() => applyAlignMarkers({ type: "html", value: "x" })).not.toThrow();
  });
});

describe("alignClass / isAlign", () => {
  it("names one class per side", () => {
    expect(alignClass("left")).toBe("qj-align--left");
    expect(alignClass("center")).toBe("qj-align--center");
    expect(alignClass("right")).toBe("qj-align--right");
  });

  it("narrows unknown values", () => {
    expect(isAlign("left")).toBe(true);
    expect(isAlign("diagonal")).toBe(false);
    expect(isAlign(undefined)).toBe(false);
  });
});
