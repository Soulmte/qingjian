import { describe, expect, it, vi } from "vitest";

import type { ResolvedImage } from "@/lib/clipboard-image";
import {
  compressImage,
  scaledSize,
  targetMime,
  type DecodedImage,
  type EncodeTarget,
  type ImageCodec,
} from "@/lib/image-compress";

const OPTIONS = { enabled: true, maxEdge: 1920, quality: 82 };

/** An image whose bytes are just its own length, so sizes are easy to assert on. */
function image(mime: string, size: number): ResolvedImage {
  return { mime, bytes: new Array(size).fill(0) };
}

/** A codec that hands back a fixed picture and echoes a fixed encoded length. */
function fakeCodec(
  decoded: Partial<DecodedImage> & { width: number; height: number },
  encodedSize: number,
): { codec: ImageCodec; encode: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const encode = vi.fn(async (_target: EncodeTarget) => new Uint8Array(encodedSize));
  const close = vi.fn();
  return {
    encode,
    close,
    codec: {
      open: async () => ({
        width: decoded.width,
        height: decoded.height,
        alpha: decoded.alpha ?? false,
        encode,
        close,
      }),
    },
  };
}

describe("scaledSize", () => {
  it("shrinks the long edge down to the limit", () => {
    expect(scaledSize(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440, scaled: true });
  });

  it("leaves an image that is already small enough", () => {
    expect(scaledSize(800, 600, 1920)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it("never rounds a thin image down to zero", () => {
    // A 4000×2 banner scaled to a 1px limit would round to 0, which canvas refuses.
    expect(scaledSize(4000, 2, 1)).toEqual({ width: 1, height: 1, scaled: true });
  });

  it("measures by the long edge, not by width", () => {
    expect(scaledSize(600, 4000, 1920)).toEqual({ width: 288, height: 1920, scaled: true });
  });
});

describe("targetMime", () => {
  it("uses PNG when there is transparency to preserve", () => {
    expect(targetMime("image/jpeg", true)).toBe("image/png");
  });

  it("keeps PNG as PNG even without transparency", () => {
    // Downscaling a screenshot already saves most of the bytes; JPEG would add
    // ringing around every glyph.
    expect(targetMime("image/png", false)).toBe("image/png");
  });

  it("moves the formats nobody renders well onto JPEG", () => {
    for (const source of ["image/bmp", "image/tiff", "image/avif", "image/webp"]) {
      expect(targetMime(source, false), source).toBe("image/jpeg");
    }
  });

  it("leaves JPEG as JPEG", () => {
    expect(targetMime("image/jpeg", false)).toBe("image/jpeg");
  });
});

describe("compressImage", () => {
  it("does nothing at all when the setting is off", async () => {
    const open = vi.fn();
    const codec: ImageCodec = { open };

    const source = image("image/bmp", 400_000);
    const result = await compressImage(source, { ...OPTIONS, enabled: false }, codec);

    expect(result).toBe(source);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves formats it must not touch", async () => {
    for (const mime of ["image/svg+xml", "image/gif", "image/x-icon"]) {
      const open = vi.fn();
      const source = image(mime, 900_000);
      const result = await compressImage(source, OPTIONS, { open });

      expect(result, mime).toBe(source);
      expect(open, mime).not.toHaveBeenCalled();
    }
  });

  it("scales down and re-encodes", async () => {
    const { codec, encode } = fakeCodec({ width: 3000, height: 2000 }, 90_000);

    const result = await compressImage(image("image/jpeg", 500_000), OPTIONS, codec);

    expect(encode).toHaveBeenCalledWith({
      width: 1920,
      height: 1280,
      mime: "image/jpeg",
      quality: 82,
    });
    expect(result).toEqual({ mime: "image/jpeg", bytes: expect.any(Array) });
    expect(result.bytes).toHaveLength(90_000);
  });

  it("converts a format nobody renders, even when the size is fine", async () => {
    const { codec, encode } = fakeCodec({ width: 800, height: 600 }, 80_000);

    const result = await compressImage(image("image/bmp", 600_000), OPTIONS, codec);

    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({ mime: "image/jpeg", width: 800, height: 600 }),
    );
    expect(result.mime).toBe("image/jpeg");
  });

  it("falls back to PNG for a translucent picture", async () => {
    const { codec, encode } = fakeCodec({ width: 3000, height: 3000, alpha: true }, 40_000);

    const result = await compressImage(image("image/webp", 300_000), OPTIONS, codec);

    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ mime: "image/png" }));
    expect(result.mime).toBe("image/png");
  });

  it("skips the work when nothing would change and the file is small", async () => {
    const { codec, encode } = fakeCodec({ width: 400, height: 300 }, 5000);

    const source = image("image/jpeg", 50_000);
    const result = await compressImage(source, OPTIONS, codec);

    expect(result).toBe(source);
    expect(encode).not.toHaveBeenCalled();
  });

  it("keeps the original when re-encoding would make it bigger", async () => {
    // A JPEG that is already tight: re-compressing it at 82 can easily grow it.
    const { codec } = fakeCodec({ width: 3000, height: 2000 }, 700_000);

    const source = image("image/jpeg", 500_000);
    const result = await compressImage(source, OPTIONS, codec);

    expect(result).toBe(source);
  });

  it("keeps the original when the image cannot be decoded", async () => {
    const source = image("image/jpeg", 500_000);
    const result = await compressImage(source, OPTIONS, { open: async () => null });

    expect(result).toBe(source);
  });

  it("keeps the original when encoding produces nothing", async () => {
    const close = vi.fn();
    const codec: ImageCodec = {
      open: async () => ({
        width: 3000,
        height: 2000,
        alpha: false,
        encode: async () => null,
        close,
      }),
    };

    const source = image("image/jpeg", 500_000);
    const result = await compressImage(source, OPTIONS, codec);

    expect(result).toBe(source);
    // Whatever happens to the bytes, the decoded bitmap is released.
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases the decoded image even when encoding throws", async () => {
    const close = vi.fn();
    const codec: ImageCodec = {
      open: async () => ({
        width: 3000,
        height: 2000,
        alpha: false,
        encode: async () => {
          throw new Error("canvas 炸了");
        },
        close,
      }),
    };

    await expect(compressImage(image("image/jpeg", 500_000), OPTIONS, codec)).rejects.toThrow(
      "canvas 炸了",
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
