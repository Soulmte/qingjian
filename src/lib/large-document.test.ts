import { describe, expect, it } from "vitest";

import {
  describeDocumentSize,
  isLargeDocument,
  LARGE_DOCUMENT_CHARS,
} from "@/lib/large-document";

describe("isLargeDocument", () => {
  it("flags a document at or above the threshold", () => {
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS - 1))).toBe(false);
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS))).toBe(true);
    expect(isLargeDocument("a".repeat(LARGE_DOCUMENT_CHARS + 1))).toBe(true);
  });
});

describe("describeDocumentSize", () => {
  it("reads as 万字", () => {
    expect(describeDocumentSize("a".repeat(250_000))).toBe("约 25 万字");
    expect(describeDocumentSize("a".repeat(55_000))).toBe("约 5.5 万字");
  });
});
