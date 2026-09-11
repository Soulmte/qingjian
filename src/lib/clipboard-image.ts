/**
 * Turns whatever the clipboard carries into image bytes.
 *
 * Copying an image produces a different payload depending on where it came
 * from: a screenshot tool puts a `File` on the clipboard, a web page puts HTML
 * containing an `<img src="https://…">` with no bytes at all, and some apps put
 * a `data:` URL in the plain-text half. Resolving all of them here keeps the
 * editor's paste handler down to a single decision.
 */

/** The parts of `DataTransfer` this module reads; tests pass plain objects. */
export interface ClipboardPayload {
  files?: ArrayLike<ClipboardFile> | null;
  items?: ArrayLike<ClipboardItem> | null;
  getData?: (type: string) => string;
}

export interface ClipboardFile {
  type: string;
  name?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface ClipboardItem {
  kind: string;
  type: string;
  getAsFile: () => ClipboardFile | null;
}

/** What was recognised, before any bytes have been read. */
export type ClipboardImagePlan =
  | { kind: "file"; file: ClipboardFile }
  | { kind: "bytes"; mime: string; bytes: number[] }
  | { kind: "source"; source: string };

/** Bytes plus the MIME type that decides the stored file's extension. */
export interface ResolvedImage {
  mime: string;
  bytes: number[];
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i;
const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i;
/** Only a link that names an image is trusted; a page address is left alone. */
const IMAGE_URL = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)($|[?#])/i;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/i;

/** Decodes a base64 `data:` URL, or `null` when it is not one or is broken. */
export function parseDataUrl(value: string): { mime: string; bytes: number[] } | null {
  const match = DATA_URL.exec(value.trim());
  if (!match) return null;

  try {
    return { mime: match[1].toLowerCase(), bytes: decodeBase64(match[2]) };
  } catch {
    // `atob` throws on malformed input; a truncated paste is not worth a crash.
    return null;
  }
}

/**
 * Finds the source of the first image in an HTML fragment.
 *
 * Some applications put the image URL itself on the clipboard and label it
 * `text/html`, so a bare data URL is accepted as well as a real `<img>` tag.
 */
export function findImageSource(html: string): string | null {
  if (!html) return null;

  const match = IMG_SRC.exec(html);
  if (match) {
    const source = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (source) return source;
  }

  const trimmed = html.trim();
  return DATA_URL.test(trimmed) ? trimmed : null;
}

/** A file-name hint taken from a URL or path, so the stored name stays read-able. */
export function sourceHint(source: string): string {
  const withoutQuery = source.split(/[?#]/)[0];
  return withoutQuery.split(/[\\/]/).pop() ?? "";
}

/** Decides where an image would come from, or `null` if this is not one. */
export function detectClipboardImage(data: ClipboardPayload | null): ClipboardImagePlan | null {
  if (!data) return null;

  const file = firstImageFile(data);
  if (file) return { kind: "file", file };

  if (typeof data.getData !== "function") return null;
  const read = data.getData.bind(data);

  const html = safeGetData(read, "text/html");
  if (html) {
    const source = findImageSource(html);
    if (source) {
      // Coming from an `<img>` tag is proof enough that a remote URL is an image.
      const plan = classifySource(source, true);
      if (plan) return plan;
    }
  }

  const text = safeGetData(read, "text/plain");
  if (text) {
    // A bare address is only trusted when it names an image file.
    const plan = classifySource(text, false);
    if (plan) return plan;
  }

  return null;
}

/** Reads the bytes a plan points at, fetching the ones the clipboard omitted. */
export async function resolveClipboardImage(
  plan: ClipboardImagePlan,
  fetchSource: (source: string) => Promise<{ data: number[]; mime: string }>,
): Promise<ResolvedImage> {
  if (plan.kind === "bytes") {
    return { mime: plan.mime, bytes: plan.bytes };
  }

  if (plan.kind === "source") {
    const fetched = await fetchSource(plan.source);
    if (fetched.data.length === 0) throw new Error("图片内容为空");
    return { mime: fetched.mime || "image/png", bytes: fetched.data };
  }

  const buffer = await plan.file.arrayBuffer();
  return {
    mime: plan.file.type || mimeFromName(plan.file.name) || "image/png",
    bytes: Array.from(new Uint8Array(buffer)),
  };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** MIME type implied by a file name, or `""` when it names no known image. */
function mimeFromName(name: string | undefined): string {
  const extension = name?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/tiff": "tiff",
};

/** Builds a safe, extension-correct file name for a stored image. */
export function imageFileName(mime: string, hint?: string): string {
  const extension = EXTENSION_BY_MIME[mime.toLowerCase()] ?? "png";
  const stem = (hint ?? "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);

  return `${stem || `image-${Date.now()}`}.${extension}`;
}

function firstImageFile(data: ClipboardPayload): ClipboardFile | null {
  for (const file of Array.from(data.files ?? [])) {
    if (isImageLike(file)) return file;
  }

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && isImageLike({ type: item.type })) {
      const file = item.getAsFile();
      if (file && isImageLike(file)) return file;
    }
  }

  return null;
}

/**
 * Whether a clipboard file looks like an image.
 *
 * A bitmap copied from another application can arrive with an empty `type`, so
 * a missing MIME type is not on its own a reason to reject — the file name then
 * has to vouch for it. A *declared* non-image type is always believed.
 */
function isImageLike(file: { type: string; name?: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type) return false;
  return file.name === undefined || file.name === "" || mimeFromName(file.name) !== "";
}

function classifySource(value: string, allowRemote: boolean): ClipboardImagePlan | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
  if (!trimmed) return null;

  if (/^data:/i.test(trimmed)) {
    const parsed = parseDataUrl(trimmed);
    return parsed ? { kind: "bytes", mime: parsed.mime, bytes: parsed.bytes } : null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    if (!allowRemote && !IMAGE_URL.test(trimmed)) return null;
    return { kind: "source", source: trimmed };
  }

  // A protocol-relative address has no scheme to hand the backend.
  if (trimmed.startsWith("//")) {
    if (!allowRemote && !IMAGE_URL.test(trimmed)) return null;
    return { kind: "source", source: `https:${trimmed}` };
  }

  if (/^file:\/\//i.test(trimmed)) {
    return { kind: "source", source: trimmed };
  }

  if (ABSOLUTE_PATH.test(trimmed) && IMAGE_URL.test(trimmed)) {
    return { kind: "source", source: trimmed };
  }

  return null;
}

function safeGetData(read: (type: string) => string, type: string): string {
  try {
    return read(type) ?? "";
  } catch {
    return "";
  }
}

function decodeBase64(value: string): number[] {
  const clean = value.replace(/\s+/g, "");
  const padded = clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Array.from(binary, (char) => char.charCodeAt(0));
}
