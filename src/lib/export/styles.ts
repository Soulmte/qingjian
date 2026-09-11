import { dirOf, resolveRelative } from "@/lib/paths";
import type { AppSettings, ExportFormat } from "@/types";

/**
 * The style block the Rust renderers consume. Field names match
 * `ExportStyles` in `src-tauri/src/commands/export.rs`, which is why they are
 * spelled out again here instead of being derived from the flat settings keys.
 */
export interface ExportStylePayload {
  bodyFont: string;
  bodyFontSize: number;
  bodyLineHeight: number;
  headingFont: string;
  headingBold: boolean;
  headingColor: string;
  headingSizes: number[];
  headingSpaceBefore: number;
  headingSpaceAfter: number;
  codeFont: string;
  codeFontSize: number;
  codeBackground: string;
  pageSize: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  tableBorders: boolean;
  tableHeaderFill: string;
  imageMaxWidth: number;
  title: string;
}

/**
 * Maps the flat settings onto the renderer's style block.
 *
 * The export fonts fall back to the editor's, so "same as what I write in" is
 * the default and the user only has to say something when the printed version
 * should differ.
 */
export function exportStylePayload(settings: AppSettings, noteTitle: string): ExportStylePayload {
  return {
    bodyFont: settings.exportBodyFont || settings.editorFont,
    bodyFontSize: settings.exportBodyFontSize,
    bodyLineHeight: settings.exportBodyLineHeight,
    headingFont: settings.exportHeadingFont,
    headingBold: settings.exportHeadingBold,
    headingColor: settings.exportHeadingColor,
    headingSizes: settings.exportHeadingSizes,
    headingSpaceBefore: settings.exportHeadingSpaceBefore,
    headingSpaceAfter: settings.exportHeadingSpaceAfter,
    codeFont: settings.exportCodeFont || settings.codeFont,
    codeFontSize: settings.exportCodeFontSize,
    codeBackground: settings.exportCodeBackground,
    pageSize: settings.exportPageSize,
    marginTop: settings.exportMarginTop,
    marginBottom: settings.exportMarginBottom,
    marginLeft: settings.exportMarginLeft,
    marginRight: settings.exportMarginRight,
    tableBorders: settings.exportTableBorders,
    tableHeaderFill: settings.exportTableHeaderFill,
    imageMaxWidth: settings.exportImageMaxWidth,
    title: settings.exportIncludeTitle ? noteTitle : "",
  };
}

/** What the save dialog offers, in the order the formats are listed. */
export const EXPORT_FILTERS = [
  { name: "Word 文档", extensions: ["docx"] },
  { name: "PDF 文档", extensions: ["pdf"] },
  { name: "网页", extensions: ["html"] },
  { name: "纯文本", extensions: ["txt"] },
  { name: "Markdown", extensions: ["md"] },
];

const KNOWN: ExportFormat[] = ["docx", "pdf", "html", "txt", "md"];

/** The format a chosen file name asks for, or `null` when the extension is new. */
export function formatFromPath(path: string): ExportFormat | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return (KNOWN as string[]).includes(extension) ? (extension as ExportFormat) : null;
}

/**
 * The absolute path of an image a note references.
 *
 * Markdown resolves a relative image against the document, and the Rust side
 * needs a real path to embed the bytes, so this mirrors what `resolveImageSrc`
 * does for the editor. Remote and `data:` sources have no file, and saying so
 * lets the renderers fall back to the link instead of failing the export.
 */
export function resolveImageFile(
  src: string,
  noteRelPath: string,
  workspaceRoot: string,
): string | undefined {
  if (/^[a-z][a-z0-9+.-]+:/i.test(src) || src.startsWith("//") || !workspaceRoot) {
    return undefined;
  }
  // A Windows drive path is already absolute.
  if (/^[a-z]:[\\/]/i.test(src)) return src;

  const relative = resolveRelative(src, dirOf(noteRelPath));
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  return [root, ...relative.split("/")].join(separator);
}
