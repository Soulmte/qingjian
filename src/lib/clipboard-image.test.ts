import { describe, expect, it, vi } from "vitest";

import {
  detectClipboardImage,
  findImageSource,
  imageFileName,
  parseDataUrl,
  resolveClipboardImage,
  sourceHint,
  type ClipboardFile,
  type ClipboardPayload,
} from "@/lib/clipboard-image";

/** A `DataTransfer`-shaped double: only the members the resolver reads. */
function payload(parts: {
  files?: ClipboardFile[];
  items?: { kind: string; type: string; file: ClipboardFile | null }[];
  html?: string;
  text?: string;
}): ClipboardPayload {
  const flavours: Record<string, string> = {};
  if (parts.html !== undefined) flavours["text/html"] = parts.html;
  if (parts.text !== undefined) flavours["text/plain"] = parts.text;

  return {
    files: parts.files ?? [],
    items: (parts.items ?? []).map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file,
    })),
    getData: (type) => flavours[type] ?? "",
  };
}

function imageFile(bytes: number[], type = "image/png", name = "a.png"): ClipboardFile {
  return {
    type,
    name,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

describe("parseDataUrl", () => {
  it("decodes a base64 image payload", () => {
    expect(parseDataUrl("data:image/png;base64,AQID")).toEqual({
      mime: "image/png",
      bytes: [1, 2, 3],
    });
  });

  it("tolerates missing padding and whitespace", () => {
    expect(parseDataUrl("data:image/gif;base64,AQI\n")).toEqual({
      mime: "image/gif",
      bytes: [1, 2],
    });
  });

  it("ignores anything that is not a base64 image", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("data:image/png,AQID")).toBeNull();
    expect(parseDataUrl("data:text/plain;base64,AQID")).toBeNull();
  });
});

describe("findImageSource", () => {
  it("reads the src of the first image", () => {
    expect(findImageSource('<p>x</p><img src="https://e.test/a.png" alt="">')).toBe(
      "https://e.test/a.png",
    );
    expect(findImageSource("<img src='https://e.test/b.png'>")).toBe("https://e.test/b.png");
    expect(findImageSource("<img src=https://e.test/c.png>")).toBe("https://e.test/c.png");
  });

  it("accepts a bare data URL, which some apps label as HTML", () => {
    expect(findImageSource("data:image/png;base64,AQID")).toBe("data:image/png;base64,AQID");
  });

  it("returns nothing when there is no image", () => {
    expect(findImageSource("<p>just text</p>")).toBeNull();
    expect(findImageSource("")).toBeNull();
  });
});

describe("detectClipboardImage", () => {
  it("prefers a real file, which is what a screenshot tool places", () => {
    const file = imageFile([1, 2, 3]);
    expect(detectClipboardImage(payload({ files: [file] }))).toEqual({ kind: "file", file });
  });

  it("falls back to file entries in `items`", () => {
    const file = imageFile([4, 5]);
    const plan = detectClipboardImage(
      payload({ items: [{ kind: "file", type: "image/png", file }] }),
    );
    expect(plan).toEqual({ kind: "file", file });
  });

  it("takes a remote URL out of copied HTML, which carries no bytes", () => {
    const plan = detectClipboardImage(
      payload({ html: '<img src="https://e.test/pic.png">' }),
    );
    expect(plan).toEqual({ kind: "source", source: "https://e.test/pic.png" });
  });

  it("decodes a data URL embedded in HTML without a round trip", () => {
    const plan = detectClipboardImage(
      payload({ html: '<img src="data:image/png;base64,AQID">' }),
    );
    expect(plan).toEqual({ kind: "bytes", mime: "image/png", bytes: [1, 2, 3] });
  });

  it("accepts a plain-text image link but not a page address", () => {
    expect(detectClipboardImage(payload({ text: "https://e.test/pic.PNG?raw=1" }))).toEqual({
      kind: "source",
      source: "https://e.test/pic.PNG?raw=1",
    });
    expect(detectClipboardImage(payload({ text: "https://example.com/article" }))).toBeNull();
  });

  it("accepts a local image path and rejects other files", () => {
    expect(detectClipboardImage(payload({ text: "C:\\Users\\me\\shot.png" }))).toEqual({
      kind: "source",
      source: "C:\\Users\\me\\shot.png",
    });
    expect(detectClipboardImage(payload({ text: "C:\\Users\\me\\notes.md" }))).toBeNull();
  });

  it("gives a protocol-relative address the scheme the backend needs", () => {
    expect(detectClipboardImage(payload({ html: '<img src="//cdn.test/a.png">' }))).toEqual({
      kind: "source",
      source: "https://cdn.test/a.png",
    });
  });

  it("ignores an empty or absent clipboard", () => {
    expect(detectClipboardImage(null)).toBeNull();
    expect(detectClipboardImage(payload({ text: "just some words" }))).toBeNull();
  });

  it("accepts a bitmap whose MIME type the clipboard never filled in", () => {
    // A bitmap copied from another application can arrive with an empty `type`;
    // rejecting on that alone is what made the paste look like it did nothing.
    const anonymous = imageFile([1, 2, 3], "", "");
    expect(detectClipboardImage(payload({ files: [anonymous] }))).toEqual({
      kind: "file",
      file: anonymous,
    });

    const named = imageFile([4], "", "shot.jpg");
    expect(detectClipboardImage(payload({ files: [named] }))).toEqual({ kind: "file", file: named });
  });

  it("believes a declared non-image type", () => {
    expect(
      detectClipboardImage(payload({ files: [imageFile([1], "application/pdf", "a.pdf")] })),
    ).toBeNull();
    expect(
      detectClipboardImage(payload({ files: [imageFile([1], "", "notes.md")] })),
    ).toBeNull();
  });
});

describe("resolveClipboardImage", () => {
  it("reads a file into bytes", async () => {
    const resolved = await resolveClipboardImage(
      { kind: "file", file: imageFile([9, 8, 7], "image/jpeg", "x.jpg") },
      vi.fn(),
    );
    expect(resolved).toEqual({ mime: "image/jpeg", bytes: [9, 8, 7] });
  });

  it("recovers the MIME type from the file name when none was given", async () => {
    const resolved = await resolveClipboardImage(
      { kind: "file", file: imageFile([1], "", "photo.jpg") },
      vi.fn(),
    );
    expect(resolved).toEqual({ mime: "image/jpeg", bytes: [1] });
  });

  it("passes bytes straight through", async () => {
    const fetchSource = vi.fn();
    const resolved = await resolveClipboardImage(
      { kind: "bytes", mime: "image/gif", bytes: [1] },
      fetchSource,
    );
    expect(resolved).toEqual({ mime: "image/gif", bytes: [1] });
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("defers a source to the backend fetcher", async () => {
    const fetchSource = vi.fn(async () => ({ data: [1, 2], mime: "image/webp" }));
    const resolved = await resolveClipboardImage(
      { kind: "source", source: "https://e.test/a.png" },
      fetchSource,
    );
    expect(fetchSource).toHaveBeenCalledWith("https://e.test/a.png");
    expect(resolved).toEqual({ mime: "image/webp", bytes: [1, 2] });
  });

  it("refuses an empty download", async () => {
    await expect(
      resolveClipboardImage({ kind: "source", source: "https://e.test/a.png" }, async () => ({
        data: [],
        mime: "image/png",
      })),
    ).rejects.toThrow("图片内容为空");
  });
});

describe("imageFileName", () => {
  it("uses the extension the MIME type implies", () => {
    expect(imageFileName("image/jpeg")).toMatch(/^image-\d+\.jpg$/);
    expect(imageFileName("image/svg+xml")).toMatch(/^image-\d+\.svg$/);
    expect(imageFileName("application/octet-stream")).toMatch(/^image-\d+\.png$/);
  });

  it("keeps a readable stem from the source and strips what it cannot use", () => {
    expect(imageFileName("image/png", "shot.png")).toBe("shot.png");
    expect(imageFileName("image/png", "my screenshot (1).png")).toBe("my-screenshot-1.png");
    expect(imageFileName("image/jpeg", "photo.jpeg")).toBe("photo.jpg");
  });
});

describe("sourceHint", () => {
  it("takes the last path segment and drops the query", () => {
    expect(sourceHint("https://e.test/a/b.png?raw=1")).toBe("b.png");
    expect(sourceHint("file:///C:/img/c.png")).toBe("c.png");
    expect(sourceHint("C:\\Users\\me\\d.jpg")).toBe("d.jpg");
  });
});
