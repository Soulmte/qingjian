import { convertFileSrc } from "@tauri-apps/api/core";

import { api } from "@/lib/api";
import { stripAlignment } from "@/lib/editor/image-align";
import { dirOf, relativeTo, resolveRelative } from "@/lib/paths";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";

/**
 * Schemes that already point somewhere the webview can fetch. Two characters or
 * more, so a Windows drive letter (`C:`) is not mistaken for one.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

/**
 * Where a pasted image ended up, so the caller can say something useful.
 */
export interface StoredImage {
  /** Markdown that references the image. */
  markdown: string;
  /** What the reference points at, for a status message. */
  reference: string;
  location: "local" | "git";
}

/**
 * Stores one image and returns the Markdown that references it.
 *
 * Two destinations share this path: the workspace's own folder (relative path,
 * portable) or a Git repository (absolute URL, works anywhere but depends on
 * the remote). Both paste/drop and the toolbar's insert command go through
 * here, so the two cannot drift apart.
 */
export async function storeImage(fileName: string, data: number[]): Promise<StoredImage> {
  const settings = useSettings.getState().settings;

  if (settings.imageUploadMode === "git") {
    const reference = await api.uploadImageToGit({
      provider: settings.gitProvider,
      repo: settings.gitRepo,
      branch: settings.gitBranch,
      dir: settings.gitImageDir,
      fileName,
      data,
    });
    return { markdown: `![](${reference})`, reference, location: "git" };
  }

  const workspaceId = useWorkspace.getState().activeWorkspaceId;
  if (workspaceId === null) throw new Error("请先打开一个工作区");

  const storedPath = await api.saveImage(workspaceId, settings.imageDir, fileName, data);
  // The image lives in the configured asset folder, but the reference written
  // into the document is the route from *this* document to it, which is what
  // every other Markdown tool expects to read.
  const relPath = fromActiveNote(storedPath);
  const encoded = encodeURI(relPath);
  return { markdown: `![](${encoded})`, reference: relPath, location: "local" };
}

/** Rewrites a workspace-relative path to be relative to the open document. */
function fromActiveNote(workspaceRelative: string): string {
  const { activeNoteId, notes } = useWorkspace.getState();
  const note = notes.find((item) => item.id === activeNoteId);
  return note ? relativeTo(note.relPath, workspaceRelative) : workspaceRelative;
}

/** The folder of the open document, used to resolve a relative reference. */
function activeNoteDir(): string {
  const { activeNoteId, notes } = useWorkspace.getState();
  const note = notes.find((item) => item.id === activeNoteId);
  return note ? dirOf(note.relPath) : "";
}

/**
 * Maps the `src` stored in Markdown to a URL the webview can load.
 *
 * Markdown keeps workspace-relative paths so the files stay portable, but the
 * webview resolves a bare relative path against `tauri://localhost` and finds
 * nothing. Tauri's asset protocol is the bridge; this turns the stored value
 * into an asset URL at render time only, so the document on disk is untouched.
 *
 * Wired into Crepe through `ImageBlockConfig.proxyDomURL`, which is the
 * supported hook for exactly this (a component may render any node, but the
 * URL it loads has to be mapped first).
 */
export function resolveImageSrc(src: string): string {
  // The alignment marker rides in the fragment; it is not part of the path.
  const value = stripAlignment(src).trim();
  if (!value) return src;

  // Already loadable: http(s), data, blob, asset, tauri, protocol-relative.
  if (HAS_SCHEME.test(value) || value.startsWith("//")) return value;
  if (WINDOWS_ABSOLUTE.test(value)) return convertFileSrc(value);

  const { activeWorkspaceId, workspaces } = useWorkspace.getState();
  const root = workspaces.find((item) => item.id === activeWorkspaceId)?.rootPath;
  if (!root) return src;

  // Relative to the document, not to the workspace root — see `paths.ts`.
  return convertFileSrc(joinPath(root, safeDecode(resolveRelative(value, activeNoteDir()))));
}

/** `decodeURI` throws on a stray `%`; a literal path is a better fallback. */
function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Joins a workspace root and a relative path using the root's own separator. */
function joinPath(root: string, relative: string): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const separator = trimmedRoot.includes("\\") ? "\\" : "/";
  const parts = relative
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  return [trimmedRoot, ...parts].join(separator);
}

/**
 * Directories that already exist in the workspace, taken from the note index.
 *
 * Used by the folder pickers so a path is chosen rather than typed. The paths
 * are workspace-relative and use forward slashes, matching `relPath`.
 */
export function workspaceFolders(relPaths: string[]): string[] {
  const folders = new Set<string>();
  for (const relPath of relPaths) {
    const index = relPath.lastIndexOf("/");
    if (index > 0) folders.add(relPath.slice(0, index));
  }
  return [...folders].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

/**
 * Rewrites an absolute path into a workspace-relative one, or `null` when it
 * falls outside the workspace.
 *
 * The folder dialogs hand back absolute paths, while the settings and the note
 * model are workspace-relative; converting here is what keeps a "choose a
 * folder" button honest instead of silently writing an absolute path into a
 * setting that is meant to be portable.
 */
export function toWorkspaceRelative(rootPath: string, absolute: string): string | null {
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = absolute.replace(/\\/g, "/").replace(/\/+$/, "");
  const lowered = target.toLowerCase();

  if (lowered === root) return "";
  if (!lowered.startsWith(`${root}/`)) return null;

  return target.slice(root.length + 1);
}
