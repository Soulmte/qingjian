import { describe, expect, it } from "vitest";

import { alignClass } from "@/lib/editor/align";
import {
  alignmentOf,
  stripAlignment,
  withAlignment,
} from "@/lib/editor/image-align";

describe("alignmentOf", () => {
  it("defaults to centred when the URL says nothing", () => {
    expect(alignmentOf("assets/a.png")).toBe("center");
    expect(alignmentOf("https://e.test/a.png")).toBe("center");
    expect(alignmentOf("")).toBe("center");
  });

  it("reads the side out of the fragment", () => {
    expect(alignmentOf("assets/a.png#qj-align=left")).toBe("left");
    expect(alignmentOf("assets/a.png#qj-align=right")).toBe("right");
    expect(alignmentOf("assets/a.png#qj-align=center")).toBe("center");
  });

  it("ignores a value it does not know", () => {
    expect(alignmentOf("assets/a.png#qj-align=diagonal")).toBe("center");
    expect(alignmentOf("assets/a.png#qj-align")).toBe("center");
  });

  it("finds the marker alongside an unrelated fragment", () => {
    expect(alignmentOf("assets/a.png#zoom=2&qj-align=left")).toBe("left");
  });
});

describe("withAlignment", () => {
  it("writes the default with no fragment at all", () => {
    expect(withAlignment("assets/a.png", "center")).toBe("assets/a.png");
  });

  it("adds and replaces the marker", () => {
    expect(withAlignment("assets/a.png", "left")).toBe("assets/a.png#qj-align=left");
    expect(withAlignment("assets/a.png#qj-align=left", "right")).toBe(
      "assets/a.png#qj-align=right",
    );
    expect(withAlignment("assets/a.png#qj-align=left", "center")).toBe("assets/a.png");
  });

  it("keeps a fragment that is not ours", () => {
    expect(withAlignment("assets/a.png#zoom=2", "left")).toBe("assets/a.png#zoom=2&qj-align=left");
    expect(withAlignment("assets/a.png#zoom=2&qj-align=left", "center")).toBe("assets/a.png#zoom=2");
  });

  it("round-trips through alignmentOf", () => {
    for (const align of ["left", "center", "right"] as const) {
      for (const src of ["assets/a.png", "assets/a.png#zoom=2"]) {
        expect(alignmentOf(withAlignment(src, align))).toBe(align);
      }
    }
  });
});

describe("stripAlignment", () => {
  it("removes only the marker, so a relative path resolves", () => {
    expect(stripAlignment("assets/a.png#qj-align=left")).toBe("assets/a.png");
    expect(stripAlignment("assets/a.png#qj-align=left&zoom=2")).toBe("assets/a.png#zoom=2");
    expect(stripAlignment("assets/a.png")).toBe("assets/a.png");
    expect(stripAlignment("assets/a.png#zoom=2")).toBe("assets/a.png#zoom=2");
  });
});

describe("alignmentClass", () => {
  it("names one class per side", () => {
    expect(alignClass("left")).toBe("qj-align--left");
    expect(alignClass("right")).toBe("qj-align--right");
    expect(alignClass("center")).toBe("qj-align--center");
  });
});
