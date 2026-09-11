import { describe, expect, it } from "vitest";

import { dirOf, relativeTo, resolveRelative } from "@/lib/paths";

describe("dirOf", () => {
  it("returns the folder, and nothing for a root file", () => {
    expect(dirOf("notes/rust/a.md")).toBe("notes/rust");
    expect(dirOf("a.md")).toBe("");
    expect(dirOf("")).toBe("");
  });
});

describe("resolveRelative", () => {
  it("resolves against the document's folder", () => {
    expect(resolveRelative("assets/a.png", "notes")).toBe("notes/assets/a.png");
    expect(resolveRelative("./assets/a.png", "notes/rust")).toBe("notes/rust/assets/a.png");
  });

  it("walks out of the folder with ..", () => {
    expect(resolveRelative("../assets/a.png", "notes")).toBe("assets/a.png");
    expect(resolveRelative("../../assets/a.png", "notes/rust/deep")).toBe("notes/assets/a.png");
  });

  it("stays put for a document at the root", () => {
    expect(resolveRelative("assets/a.png", "")).toBe("assets/a.png");
  });

  it("normalises separators and redundant segments", () => {
    expect(resolveRelative("assets\\img//a.png", "notes")).toBe("notes/assets/img/a.png");
  });

  it("does not escape past the root", () => {
    expect(resolveRelative("../../a.png", "notes")).toBe("a.png");
  });
});

describe("relativeTo", () => {
  it("walks up and back down", () => {
    expect(relativeTo("notes/a.md", "assets/x.png")).toBe("../assets/x.png");
    expect(relativeTo("a.md", "assets/x.png")).toBe("assets/x.png");
    expect(relativeTo("notes/rust/a.md", "assets/x.png")).toBe("../../assets/x.png");
  });

  it("uses the shared prefix instead of climbing to the root", () => {
    expect(relativeTo("notes/deep/a.md", "notes/assets/x.png")).toBe("../assets/x.png");
  });

  it("round-trips through resolveRelative", () => {
    for (const [note, target] of [
      ["a.md", "assets/x.png"],
      ["notes/a.md", "assets/x.png"],
      ["notes/rust/a.md", "assets/x.png"],
      ["notes/deep/a.md", "notes/assets/x.png"],
    ] as const) {
      expect(resolveRelative(relativeTo(note, target), dirOf(note))).toBe(target);
    }
  });
});
