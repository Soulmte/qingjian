/**
 * 图片在落盘之前先做一次瘦身。
 *
 * 粘贴进来的图有个通病：截图工具给的是 Retina 分辨率（逻辑尺寸的两倍），相机
 * 照片则动辄四五兆。这些东西一旦进了工作区就会一直待着，走图床时还会原样推到
 * 远端，所以缩减要在**存下来的那一刻**做，而不是等用户自己去压。
 *
 * 这里只做两件事——缩尺寸、换格式，都不改变画面的构图：
 *
 * - 缩尺寸：长边超过上限就等比缩到上限。截图缩一半在 1x 屏上看不出区别。
 * - 换格式：BMP / TIFF / AVIF / WebP 这些「能存但处处不吃」的格式转成 JPEG
 *   （有透明通道的转 PNG），省下的通常是数倍。
 *
 * PNG 保持 PNG，只缩尺寸。截图里全是文字，JPEG 的振铃噪声在字边上是看得见的，
 * 与其把字压糊不如少省一点。
 *
 * 「压不压、压成什么」这层是纯函数，浏览器那套 canvas 编解码藏在 `codec` 后面，
 * 所以这一层不需要 DOM 就能测（见 `image-compress.test.ts`）。
 */

import type { ResolvedImage } from "@/lib/clipboard-image";

/** 用户设置里的三个旋钮。 */
export interface CompressOptions {
  enabled: boolean;
  /** 长边上限，像素。 */
  maxEdge: number;
  /** JPEG 质量，1–100。PNG 用不到。 */
  quality: number;
}

/** 解出来的图，外加一个重编码的口子。用完要 `close`。 */
export interface DecodedImage {
  width: number;
  height: number;
  /** 是否真有透明像素——决定 JPEG（会被填黑）还是 PNG。 */
  alpha: boolean;
  encode(target: EncodeTarget): Promise<Uint8Array | null>;
  close(): void;
}

export interface EncodeTarget {
  width: number;
  height: number;
  mime: string;
  /** 1–100；PNG 忽略。 */
  quality: number;
}

/** 解码器。真实的那个用 canvas，测试里换成假的。 */
export interface ImageCodec {
  /** 解一次；损坏或格式不支持时返回 `null`。 */
  open(image: ResolvedImage): Promise<DecodedImage | null>;
}

/**
 * 碰不得的格式。
 *
 * - SVG 是矢量：栅格化之后再存回去等于把这幅图毁了。
 * - GIF 可能是动图：canvas 只画第一帧，压缩会把动画压没。
 * - ICO 是个容器，里面可能装着好几个尺寸，转出去只剩一个。
 */
const UNTOUCHABLE = new Set(["image/svg+xml", "image/gif", "image/x-icon"]);

/**
 * 小于这个大小就不折腾了。
 *
 * 重编码本身不是免费的，而一张几十 KB 的图压完往往只少一点点——甚至因为 JPEG
 * 再压一次而变大。这是「不值得动」的门槛，不是「必须压」的门槛。
 */
const MIN_BYTES = 120_000;

/**
 * 目标格式。
 *
 * 只有一件事在决定它：有没有透明像素。有就必须 PNG（透明度是 JPEG 没有的），
 * 没有就尽量 JPEG（照片类能省下数倍）。PNG 例外地保持 PNG，理由见文件头。
 */
export function targetMime(source: string, alpha: boolean): string {
  if (alpha) return "image/png";
  if (source === "image/png") return "image/png";
  return "image/jpeg";
}

/** 长边按上限缩放后的尺寸；不需要缩时原样返回。 */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height, scaled: false };

  const ratio = maxEdge / longest;
  return {
    // 至少留 1 像素：极端的长条图缩到底不能变成 0，那样 canvas 会拒绝绘制。
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/**
 * 压缩一张图，压不动就原样还回去。
 *
 * 任何一步不顺（解不开、画不出、编不出、压完反而更大）都回退到原图：这个函数
 * 的职责是「能让文件小一点」，不是「必须动过手」。失败静默——一张图没被压小
 * 不值得打断用户。
 */
export async function compressImage(
  image: ResolvedImage,
  options: CompressOptions,
  codec: ImageCodec,
): Promise<ResolvedImage> {
  const source = image.mime.toLowerCase();
  if (!options.enabled || UNTOUCHABLE.has(source)) return image;

  const decoded = await codec.open(image);
  if (!decoded) return image;

  try {
    const size = scaledSize(decoded.width, decoded.height, options.maxEdge);
    const mime = targetMime(source, decoded.alpha);

    // 尺寸不用缩、格式也没变、本来就不大：这一趟没有意义。
    if (!size.scaled && mime === source && image.bytes.length < MIN_BYTES) return image;

    const encoded = await decoded.encode({
      width: size.width,
      height: size.height,
      mime,
      quality: options.quality,
    });
    // 压完更大就说明这次转换不划算（JPEG 再压一次很常见），保留原图。
    if (!encoded || encoded.length >= image.bytes.length) return image;

    return { mime, bytes: Array.from(encoded) };
  } finally {
    decoded.close();
  }
}

/** canvas 那一套。只在真正跑起来的界面里用得到。 */
export function canvasCodec(): ImageCodec {
  return {
    async open(image) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(
          new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
        );
      } catch {
        // 损坏的、或者这个内核不认的格式。
        return null;
      }

      return {
        width: bitmap.width,
        height: bitmap.height,
        alpha: sampleAlpha(bitmap),
        encode: (target) => draw(bitmap, target),
        close: () => bitmap.close(),
      };
    },
  };
}

/**
 * 有没有透明像素。
 *
 * 缩到 32×32 再逐点看 alpha：照片和截图几乎必然全不透明，图标与抠过背景的图
 * 一定在边缘上留下半透明。采样比逐像素扫原图便宜好几个数量级，而这个判断本来
 * 就只需要「大致上是不是抠过图」。
 */
function sampleAlpha(bitmap: ImageBitmap): boolean {
  const side = 32;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  context.drawImage(bitmap, 0, 0, side, side);
  const { data } = context.getImageData(0, 0, side, side);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return true;
  }
  return false;
}

async function draw(bitmap: ImageBitmap, target: EncodeTarget): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  // JPEG 没有透明通道，没铺底色的话透明区域会变成黑块。
  if (target.mime === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, target.width, target.height);
  }
  context.drawImage(bitmap, 0, 0, target.width, target.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, target.mime, target.quality / 100);
  });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
