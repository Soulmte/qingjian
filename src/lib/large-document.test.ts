import { describe, expect, it } from "vitest";

import { isLargeDocument, LARGE_DOCUMENT_CHARS } from "@/lib/large-document";

describe("isLargeDocument", () => {
  it("flags a document at or above the threshold", () => {
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS - 1))).toBe(false);
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS))).toBe(true);
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS + 1))).toBe(true);
  });

  it("is safe on an empty document", () => {
    expect(isLargeDocument("")).toBe(false);
  });
});
