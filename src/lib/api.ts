import { invoke } from "@tauri-apps/api/core";

import type {
  Note,
  NoteDetail,
  SaveOutcome,
  SearchHit,
  Workspace,
} from "@/types";

/**
 * Typed wrappers around the Rust commands.
 *
 * Tauri maps camelCase argument keys from JavaScript onto the snake_case
 * parameters of the Rust commands, so `workspaceId` here becomes
 * `workspace_id` there.
 */
export const api = {
  // Settings
  loadSettings: () => invoke<Record<string, unknown>>("load_settings"),
  setSetting: (key: string, value: unknown) =>
    invoke<void>("set_setting", { key, value }),
  deleteSetting: (key: string) => invoke<void>("delete_setting", { key }),

  // Workspaces
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  /** Seeds the default workspace and tour document on first run; `null` afterwards. */
  bootstrapWorkspace: () => invoke<Workspace | null>("bootstrap_workspace"),
  addWorkspace: (rootPath: string) =>
    invoke<Workspace>("add_workspace", { rootPath }),
  removeWorkspace: (id: number) => invoke<void>("remove_workspace", { id }),
  syncWorkspace: (id: number) => invoke<Note[]>("sync_workspace", { id }),

  // Notes
  listNotes: (workspaceId: number) =>
    invoke<Note[]>("list_notes", { workspaceId }),
  readNote: (id: number) => invoke<NoteDetail>("read_note", { id }),
  /**
   * Writes the buffer.
   *
   * `expectedHash` is the version the frontend believes is on disk. When it no
   * longer matches, nothing is written and a conflict comes back instead; a file
   * edited in another editor must never be lost to a stale buffer.
   */
  saveNote: (id: number, content: string, expectedHash: string | null) =>
    invoke<SaveOutcome>("save_note", { id, content, expectedHash }),
  /** The hash of a note's file as it is now; `null` when the file has gone. */
  noteHash: (id: number) => invoke<string | null>("note_hash", { id }),
  createNote: (workspaceId: number, relPath: string) =>
    invoke<Note>("create_note", { workspaceId, relPath }),
  renameNote: (id: number, newRelPath: string) =>
    invoke<Note>("rename_note", { id, newRelPath }),
  deleteNote: (id: number) => invoke<void>("delete_note", { id }),
  searchNotes: (workspaceId: number | null, query: string) =>
    invoke<SearchHit[]>("search_notes", { workspaceId, query }),

  // Assets
  saveImage: (workspaceId: number, dir: string, fileName: string, data: number[]) =>
    invoke<string>("save_image", { workspaceId, dir, fileName, data }),
  /**
   * Downloads an image the clipboard only referenced. The fetch is done in Rust
   * because the webview has no CSP and a cross-origin read would be blocked by
   * CORS anyway.
   */
  fetchImageSource: (source: string) =>
    invoke<{ data: number[]; mime: string }>("fetch_image_source", { source }),

  // Git image hosting.
  //
  // The token is write-only from here: it is stored in the `secret` table and
  // never returned, because the webview runs without a CSP.
  setGitToken: (token: string) => invoke<void>("set_git_token", { token }),
  clearGitToken: () => invoke<void>("clear_git_token"),
  gitTokenConfigured: () => invoke<boolean>("git_token_configured"),
  /** Checks the repository and branch are reachable; throws a readable reason. */
  testGitConnection: (payload: { provider: string; repo: string; branch: string }) =>
    invoke<string>("test_git_connection", payload),
  /** Uploads one image and returns the public URL to reference it by. */
  uploadImageToGit: (payload: {
    provider: string;
    repo: string;
    branch: string;
    dir: string;
    fileName: string;
    data: number[];
  }) => invoke<string>("upload_image_to_git", payload),

  // Files
  /** Writes a copy of a note outside the workspace (另存为 / 导出). */
  exportText: (path: string, contents: string) =>
    invoke<string>("export_text", { path, contents }),
  /**
   * Renders a parsed document to the chosen format and writes it.
   *
   * The document tree is built in the frontend — see `lib/export/ir.ts` — so the
   * renderers receive exactly what the editor shows, alignment included.
   */
  exportDocument: (payload: {
    format: string;
    blocks: unknown[];
    styles: unknown;
    path: string;
  }) => invoke<string>("export_document", payload),
  /**
   * The same rendering, handed back instead of written.
   *
   * PDF is produced by the webview's own print pipeline, which needs the page in
   * the frontend — see `lib/print.ts`.
   */
  renderExport: (payload: { blocks: unknown[]; styles: unknown }) =>
    invoke<string>("render_export", payload),

  // App
  /** One-shot explanation of a startup recovery; cleared once read. */
  takeStartupNotice: () => invoke<string | null>("take_startup_notice"),
  /**
   * 启动参数里要打开的文件，取一次就清空。
   *
   * 双击 `.md` 时系统会把文件路径当第一个参数传进来，由 Rust 侧暂存。
   */
  takeOpenFile: () => invoke<string | null>("take_open_file"),

  // Shell
  /** 在系统默认浏览器里打开一个链接（项目主页、发布页）。 */
  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

/** Turns a thrown command error into something worth showing a user. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}
