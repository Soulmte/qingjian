import { convertFileSrc } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AppWindow,
  Code2,
  Command,
  Copy,
  Eraser,
  FileCode,
  FileDown,
  FilePlus2,
  FileSearch,
  Focus,
  FolderOpen,
  Keyboard,
  ListTree,
  Maximize,
  PanelLeft,
  PencilLine,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  SunMoon,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ExportFormat } from "@/types";

import { api, errorMessage } from "@/lib/api";
import type { Align } from "@/lib/editor/align";
import { applyAlign, selectedBlock } from "@/lib/editor/align-selection";
import { clearFormatting, deleteLine, selectLine } from "@/lib/editor/actions";
import { armPlainPaste, getActiveEditorView, runInsertMarkdown } from "@/lib/editor/bridge";
import { parseMarkdown } from "@/lib/export/ir";
import {
  EXPORT_FILTERS,
  exportStylePayload,
  formatFromPath,
  resolveImageFile,
} from "@/lib/export/styles";
import { storeImage } from "@/lib/images";
import { frontMatterTitle } from "@/lib/front-matter";
import { printHtml } from "@/lib/print";
import { resolveTheme } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

/**
 * The single registry every command surface reads from.
 *
 * The toolbar, the command palette, the window key handler and the shortcuts
 * page used to keep separate lists, which is how a binding could be documented
 * as working while nothing was listening for it. Declaring a command once, and
 * asserting the shortcuts page against this list in a test, is what keeps the
 * documentation honest.
 */
export interface Accel {
  /**
   * `event.key` in lowercase. Used for letters and function keys, where the
   * produced key is what matters.
   */
  key?: string;
  /**
   * `event.code`. Preferred for digits and punctuation: `Ctrl+Shift+=` reports
   * `event.key === "+"` on most layouts, and `Shift+1` would be ambiguous with
   * the outline shortcut.
   */
  code?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppCommand {
  id: string;
  title: string;
  group: string;
  icon?: ReactNode;
  /** Display form, shown in tooltips and the palette. */
  shortcut?: string;
  accel?: Accel;
  /** Shown as a button in the top bar. */
  toolbar?: boolean;
  /** Rendered as a destructive action in the toolbar. */
  danger?: boolean;
  /** The command does nothing while this returns false. */
  enabled?: () => boolean;
  /**
   * Leave the browser's default action alone.
   *
   * "Paste as plain text" only arms a flag: the paste itself has to happen
   * normally, and the editor's paste handler swaps the payload. Preventing the
   * default would cancel the paste it is waiting for.
   */
  keepDefault?: boolean;
  run: () => void | Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Path helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Repairs separators so paths from the dialog and from SQLite compare equal. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function splitPath(path: string): { dirname: string; basename: string } {
  const unified = path.replace(/\\/g, "/");
  const index = unified.lastIndexOf("/");
  return {
    dirname: index <= 0 ? unified : unified.slice(0, index),
    basename: index < 0 ? unified : unified.slice(index + 1),
  };
}

/* -------------------------------------------------------------------------- */
/* File actions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Opens a Markdown file from anywhere on disk.
 *
 * Notes are workspace-relative, so the file is adopted first: its folder
 * becomes (or is matched against) a workspace, then the note is selected by its
 * path inside that folder.
 */
async function openFile(): Promise<void> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });
  if (typeof picked !== "string") return;

  const { dirname, basename } = splitPath(picked);

  try {
    const known = useWorkspace
      .getState()
      .workspaces.find((item) => normalizePath(item.rootPath) === normalizePath(dirname));
    const workspaceId = known ? known.id : (await api.addWorkspace(dirname)).id;
    if (!known) await useWorkspace.getState().selectWorkspace(workspaceId);

    const notes = await api.syncWorkspace(workspaceId);
    useWorkspace.setState({ notes });

    const match =
      notes.find((note) => normalizePath(note.relPath) === normalizePath(basename)) ??
      notes.find((note) => normalizePath(note.relPath).endsWith(normalizePath(basename)));

    if (match) await useWorkspace.getState().selectNote(match.id);
  } catch (error) {
    useWorkspace.setState({ error: `打开文件失败：${errorMessage(error)}` });
  }
}

/**
 * The parts both the export and the print paths need: the note, its parsed block
 * tree and the style block the renderers consume.
 */
function exportInput() {
  const { activeNoteId, content, notes, workspaces } = useWorkspace.getState();
  if (activeNoteId === null) return null;

  const note = notes.find((item) => item.id === activeNoteId);
  if (!note) return null;

  const root = workspaces.find((item) => item.id === note.workspaceId)?.rootPath ?? "";
  return {
    note,
    settings: useSettings.getState().settings,
    // Metadata outranks the file name, which is what a `title:` key is for.
    title: frontMatterTitle(content) ?? note.title,
    blocks: parseMarkdown(content, {
      resolveImageFile: (src) => resolveImageFile(src, note.relPath, root),
    }),
    stem: (note.relPath.split("/").pop() ?? "未命名").replace(/\.[^.]*$/, ""),
  };
}

/**
 * Writes the current note in the format the user asked for.
 *
 * One entry point for every format, the extension included: the file name the
 * user types decides what is produced, and what is produced always matches the
 * name — a `.docx` really is a Word document, never an HTML file wearing the
 * wrong name, which Word would refuse to open.
 *
 * PDF needs no special case here: it is rendered and written on the Rust side,
 * silently, so it takes a path like the rest.
 *
 * The chosen format and the title switch are stored as the new defaults, so the
 * dialog reopens where the user left it.
 */
async function exportNote(format: ExportFormat, includeTitle: boolean): Promise<void> {
  const input = exportInput();
  if (!input) return;

  const settings = useSettings.getState().settings;
  useSettings.getState().update("exportFormat", format);
  useSettings.getState().update("exportIncludeTitle", includeTitle);

  const target = await save({ defaultPath: `${input.stem}.${format}`, filters: EXPORT_FILTERS });
  if (typeof target !== "string") return;

  // Typing another extension in the dialog still wins: what the file is called is
  // what it has to contain.
  const chosen = formatFromPath(target) ?? format;

  try {
    if (chosen === "md") {
      await api.exportText(target, useWorkspace.getState().content);
      return;
    }

    await api.exportDocument({
      format: chosen,
      blocks: input.blocks,
      styles: exportStylePayload({ ...settings, exportIncludeTitle: includeTitle }, input.title),
      path: target,
    });
  } catch (error) {
    useWorkspace.setState({ error: `导出失败：${errorMessage(error)}` });
  }
}

/** Opens the dialog that asks for a format before anything is rendered. */
function openExportDialog(): void {
  if (useWorkspace.getState().activeNoteId === null) return;
  useUi.getState().setExportOpen(true);
}

/** Entry point for the export dialog, which owns the format choice. */
export function runExport(format: ExportFormat, includeTitle: boolean): Promise<void> {
  return exportNote(format, includeTitle);
}

/** Writes a picked image to its destination and references it. */
async function insertImage(): Promise<void> {
  const workspaceId = useWorkspace.getState().activeWorkspaceId;
  if (workspaceId === null) return;

  const picked = await open({
    multiple: false,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
  });
  if (typeof picked !== "string") return;

  const { imageAutoInsert } = useSettings.getState().settings;
  const { basename } = splitPath(picked);
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot + 1) : "png";
  const fileName = `image-${Date.now()}.${extension}`;

  try {
    // `fetch` over the asset protocol is the only way to read a file from the
    // webview; the dialog plugin hands back the path, not the bytes.
    const response = await fetch(convertFileSrc(picked));
    if (!response.ok) throw new Error(`读取文件失败（${response.status}）`);
    const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));

    const stored = await storeImage(fileName, bytes);
    if (imageAutoInsert) runInsertMarkdown(stored.markdown);
  } catch (error) {
    useWorkspace.setState({ error: `插入图片失败：${errorMessage(error)}` });
  }
}

/* -------------------------------------------------------------------------- */
/* View actions                                                                */
/* -------------------------------------------------------------------------- */

async function applyZoom(factor: number): Promise<void> {
  // The webview is driven by the effect in App.tsx, so changing the setting is
  // the whole action here and there is one place that talks to the webview.
  const clamped = Math.min(1.6, Math.max(0.6, Math.round(factor * 100) / 100));
  useSettings.getState().update("zoom", clamped);
}

/** Hands the rendered note to the print dialog; PDF is saved from the same path. */
async function printNote(): Promise<void> {
  const input = exportInput();
  if (!input) return;

  try {
    await useWorkspace.getState().flushSave();
    const html = await api.renderExport({
      blocks: input.blocks,
      styles: exportStylePayload(input.settings, input.title),
    });
    await printHtml(html);
  } catch (error) {
    useWorkspace.setState({ error: `打印失败：${errorMessage(error)}` });
  }
}

/** Whether the caret sits on something the alignment commands can move. */
function hasAlignableBlock(): boolean {
  const view = getActiveEditorView();
  return view !== null && selectedBlock(view.state) !== null;
}

/**
 * Moves the selected block within the text column.
 *
 * One command covers both kinds of block: an image is re-placed through its URL
 * fragment, a paragraph or heading through its `align` attribute. They share a
 * button because the user is asking the same question — "which side?" — and
 * only the storage differs.
 */
function alignBlock(align: Align): boolean {
  const view = getActiveEditorView();
  if (!view) return false;

  const transaction = applyAlign(view.state, align);
  if (!transaction) return false;

  view.dispatch(transaction);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const APP_COMMANDS: AppCommand[] = [
  {
    id: "note.new",
    title: "新建笔记",
    group: "文件",
    icon: <FilePlus2 />,
    shortcut: "Ctrl+N",
    accel: { key: "n", mod: true },
    toolbar: true,
    enabled: () => useWorkspace.getState().activeWorkspaceId !== null,
    run: () => useUi.getState().setNewNoteOpen(true),
  },
  {
    id: "file.open",
    title: "打开文件…",
    group: "文件",
    icon: <FolderOpen />,
    shortcut: "Ctrl+O",
    accel: { key: "o", mod: true },
    toolbar: true,
    run: openFile,
  },
  {
    id: "quickopen.open",
    title: "快速打开…",
    group: "文件",
    icon: <FileSearch />,
    shortcut: "Ctrl+Shift+O",
    accel: { key: "o", mod: true, shift: true },
    toolbar: true,
    run: () => useUi.getState().setQuickOpen(true),
  },
  {
    id: "note.save",
    title: "保存",
    group: "文件",
    icon: <Save />,
    shortcut: "Ctrl+S",
    accel: { key: "s", mod: true },
    toolbar: true,
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => useWorkspace.getState().flushSave(),
  },
  {
    id: "note.export",
    title: "导出…",
    group: "文件",
    icon: <FileDown />,
    shortcut: "Ctrl+Shift+S",
    accel: { key: "s", mod: true, shift: true },
    toolbar: true,
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: openExportDialog,
  },
  {
    id: "note.print",
    title: "打印",
    group: "文件",
    icon: <Printer />,
    shortcut: "Ctrl+P",
    accel: { key: "p", mod: true },
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: printNote,
  },
  {
    id: "note.frontMatter",
    title: "编辑 YAML 元数据…",
    group: "文件",
    icon: <FileCode />,
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => useUi.getState().setFrontMatterOpen(true),
  },
  {
    id: "window.new",
    title: "新建窗口",
    group: "文件",
    icon: <AppWindow />,
    shortcut: "Ctrl+Shift+N",
    accel: { key: "n", mod: true, shift: true },
    run: () => {
      // Each window loads the same workspace list from SQLite, so a new window
      // is just another front end; the label only has to be unique.
      new WebviewWindow(`window-${Date.now()}`, {
        url: "/",
        title: "青简",
        width: 1100,
        height: 760,
      });
    },
  },
  {
    id: "note.close",
    title: "关闭文件",
    group: "文件",
    icon: <X />,
    shortcut: "Ctrl+W",
    accel: { key: "w", mod: true },
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => useWorkspace.getState().closeNote(),
  },
  {
    id: "note.delete",
    title: "删除当前笔记",
    group: "文件",
    icon: <Trash2 />,
    toolbar: true,
    danger: true,
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => {
      const { activeNoteId } = useWorkspace.getState();
      if (activeNoteId === null) return;
      if (useSettings.getState().settings.confirmBeforeDelete) {
        useUi.getState().setPendingDeleteNoteId(activeNoteId);
      } else {
        void useWorkspace.getState().deleteNote(activeNoteId);
      }
    },
  },
  {
    id: "note.rename",
    title: "重命名笔记…",
    group: "文件",
    icon: <PencilLine />,
    shortcut: "F2",
    accel: { key: "f2" },
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => {
      const { activeNoteId } = useWorkspace.getState();
      if (activeNoteId !== null) useUi.getState().setRenamingNoteId(activeNoteId);
    },
  },
  {
    id: "note.rescan",
    title: "重新扫描工作区",
    group: "文件",
    icon: <RefreshCw />,
    enabled: () => useWorkspace.getState().activeWorkspaceId !== null,
    run: () => useWorkspace.getState().rescan(),
  },
  {
    id: "app.quit",
    title: "退出应用",
    group: "文件",
    shortcut: "Ctrl+Q",
    accel: { key: "q", mod: true },
    run: async () => {
      await useWorkspace.getState().flushSave();
      await getCurrentWindow().close();
    },
  },

  {
    id: "find.open",
    title: "查找",
    group: "编辑",
    icon: <Search />,
    shortcut: "Ctrl+F",
    accel: { key: "f", mod: true },
    toolbar: true,
    run: () => useUi.getState().openFind(false),
  },
  {
    id: "replace.open",
    title: "查找与替换",
    group: "编辑",
    shortcut: "Ctrl+H",
    accel: { key: "h", mod: true },
    run: () => useUi.getState().openFind(true),
  },
  {
    id: "edit.insertImage",
    title: "插入图片…",
    group: "编辑",
    shortcut: "Ctrl+Shift+I",
    accel: { key: "i", mod: true, shift: true },
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: insertImage,
  },
  {
    id: "edit.insertMath",
    title: "插入数学公式",
    group: "编辑",
    shortcut: "Ctrl+Shift+M",
    accel: { key: "m", mod: true, shift: true },
    enabled: () => getActiveEditorView() !== null,
    run: () => runInsertMarkdown("$$\n\n$$"),
  },
  {
    id: "edit.taskList",
    title: "插入任务列表",
    group: "编辑",
    shortcut: "Ctrl+Shift+X",
    accel: { key: "x", mod: true, shift: true },
    enabled: () => getActiveEditorView() !== null,
    run: () => runInsertMarkdown("- [ ] "),
  },
  {
    id: "edit.selectLine",
    title: "选中当前行",
    group: "编辑",
    shortcut: "Ctrl+L",
    accel: { key: "l", mod: true },
    enabled: () => getActiveEditorView() !== null,
    run: () => {
      const view = getActiveEditorView();
      if (view) selectLine(view);
    },
  },
  {
    id: "edit.deleteLine",
    title: "删除当前行",
    group: "编辑",
    // Typora binds this to Ctrl+Shift+K, which the code-block command already
    // owns; Ctrl+Shift+D is the free neighbour.
    shortcut: "Ctrl+Shift+D",
    accel: { key: "d", mod: true, shift: true },
    enabled: () => getActiveEditorView() !== null,
    run: () => {
      const view = getActiveEditorView();
      if (view) deleteLine(view);
    },
  },
  {
    id: "edit.clearFormat",
    title: "清除格式",
    group: "编辑",
    icon: <Eraser />,
    shortcut: "Ctrl+\\",
    accel: { code: "Backslash", mod: true },
    enabled: () => getActiveEditorView() !== null,
    run: () => {
      const view = getActiveEditorView();
      if (view) clearFormatting(view);
    },
  },
  {
    id: "edit.copyPlain",
    title: "粘贴为纯文本",
    group: "编辑",
    icon: <Copy />,
    shortcut: "Ctrl+Shift+V",
    // Only arms a flag: the browser still performs the paste, and the editor's
    // paste handler swaps the payload for its plain-text half.
    accel: { key: "v", mod: true, shift: true },
    keepDefault: true,
    run: armPlainPaste,
  },
  {
    id: "format.alignLeft",
    title: "左对齐",
    group: "格式",
    icon: <AlignLeft />,
    // Typora's Ctrl+Shift+L is taken by the sidebar toggle; the shortcuts page
    // records that, and the top bar carries the button without a chord.
    toolbar: true,
    enabled: hasAlignableBlock,
    run: () => void alignBlock("left"),
  },
  {
    id: "format.alignCenter",
    title: "居中对齐",
    group: "格式",
    icon: <AlignCenter />,
    shortcut: "Ctrl+Shift+E",
    accel: { key: "e", mod: true, shift: true },
    toolbar: true,
    enabled: hasAlignableBlock,
    run: () => void alignBlock("center"),
  },
  {
    id: "format.alignRight",
    title: "右对齐",
    group: "格式",
    icon: <AlignRight />,
    shortcut: "Ctrl+Shift+R",
    accel: { key: "r", mod: true, shift: true },
    toolbar: true,
    enabled: hasAlignableBlock,
    run: () => void alignBlock("right"),
  },

  {
    id: "sidebar.toggle",
    title: "切换侧边栏",
    group: "视图",
    icon: <PanelLeft />,
    shortcut: "Ctrl+Shift+L",
    accel: { key: "l", mod: true, shift: true },
    toolbar: true,
    run: () => useUi.getState().toggleSidebar(),
  },
  {
    id: "nav.goTo",
    title: "跳转到标题…",
    group: "视图",
    icon: <ListTree />,
    shortcut: "Ctrl+G",
    accel: { key: "g", mod: true },
    enabled: () => useWorkspace.getState().activeNoteId !== null,
    run: () => useUi.getState().setGoToOpen(true),
  },
  {
    id: "outline.toggle",
    title: "大纲面板",
    group: "视图",
    icon: <ListTree />,
    shortcut: "Ctrl+Shift+1",
    accel: { code: "Digit1", mod: true, shift: true },
    toolbar: true,
    run: () => {
      const { showOutline } = useSettings.getState().settings;
      useSettings.getState().update("showOutline", !showOutline);
    },
  },
  {
    id: "source.toggle",
    title: "源代码模式",
    group: "视图",
    icon: <Code2 />,
    shortcut: "Ctrl+/",
    accel: { code: "Slash", mod: true },
    toolbar: true,
    run: () => useUi.getState().toggleSourceMode(),
  },
  {
    id: "focus.toggle",
    title: "专注模式",
    group: "视图",
    icon: <Focus />,
    shortcut: "F8",
    accel: { key: "f8" },
    toolbar: true,
    run: () => {
      const { focusMode } = useSettings.getState().settings;
      useSettings.getState().update("focusMode", !focusMode);
    },
  },
  {
    id: "typewriter.toggle",
    title: "打字机模式",
    group: "视图",
    icon: <Type />,
    shortcut: "F9",
    accel: { key: "f9" },
    toolbar: true,
    run: () => {
      const { typewriterMode } = useSettings.getState().settings;
      useSettings.getState().update("typewriterMode", !typewriterMode);
    },
  },
  {
    id: "fullscreen.toggle",
    title: "全屏",
    group: "视图",
    icon: <Maximize />,
    shortcut: "F11",
    accel: { key: "f11" },
    run: async () => {
      const current = getCurrentWindow();
      try {
        await current.setFullscreen(!(await current.isFullscreen()));
      } catch {
        // Refused by the window manager; nothing to recover.
      }
    },
  },
  {
    id: "zoom.in",
    title: "放大",
    group: "视图",
    icon: <ZoomIn />,
    shortcut: "Ctrl+Shift+=",
    accel: { code: "Equal", mod: true, shift: true },
    run: () => applyZoom(useSettings.getState().settings.zoom + 0.1),
  },
  {
    id: "zoom.out",
    title: "缩小",
    group: "视图",
    icon: <ZoomOut />,
    shortcut: "Ctrl+Shift+-",
    accel: { code: "Minus", mod: true, shift: true },
    run: () => applyZoom(useSettings.getState().settings.zoom - 0.1),
  },
  {
    id: "zoom.reset",
    title: "恢复默认缩放",
    group: "视图",
    icon: <RotateCcw />,
    shortcut: "Ctrl+Shift+0",
    accel: { code: "Digit0", mod: true, shift: true },
    run: () => applyZoom(1),
  },
  {
    id: "theme.toggle",
    title: "切换明暗主题",
    group: "外观",
    icon: <SunMoon />,
    shortcut: "Ctrl+Alt+N",
    accel: { key: "n", mod: true, alt: true },
    toolbar: true,
    run: () => {
      const { theme } = useSettings.getState().settings;
      useSettings.getState().update("theme", resolveTheme(theme) === "dark" ? "light" : "dark");
    },
  },

  {
    id: "palette.open",
    title: "命令面板",
    group: "应用",
    icon: <Command />,
    shortcut: "Ctrl+Shift+P",
    accel: { key: "p", mod: true, shift: true },
    toolbar: true,
    run: () => useUi.getState().setPaletteOpen(true),
  },
  {
    id: "settings.open",
    title: "设置",
    group: "应用",
    icon: <Settings />,
    shortcut: "Ctrl+,",
    accel: { code: "Comma", mod: true },
    toolbar: true,
    run: () => useUi.getState().openSettings(),
  },
  {
    id: "shortcut.help",
    title: "快捷键说明",
    group: "应用",
    icon: <Keyboard />,
    shortcut: "F1",
    accel: { key: "f1" },
    run: () => useUi.getState().openSettings("shortcuts"),
  },
];

/** Commands shown as buttons in the top bar, in registry order. */
export const TOOLBAR_COMMANDS: AppCommand[] = APP_COMMANDS.filter((command) => command.toolbar);

/**
 * Top bar order, left to right, with `null` for a divider.
 *
 * `"TITLE"` is the heading slot and `"ALIGN"` expands to the three alignment
 * commands. Every other entry must be a command that carries `toolbar: true`, or
 * the button is skipped without a word — see `TOOLBAR_LAYOUT`'s test.
 */
export const TOOLBAR_LAYOUT: (string | null)[] = [
  "sidebar.toggle",
  null,
  "note.new",
  "file.open",
  "quickopen.open",
  null,
  "note.save",
  "note.export",
  "find.open",
  null,
  "ALIGN",
  "TITLE",
  "source.toggle",
  "focus.toggle",
  "typewriter.toggle",
  "outline.toggle",
  "theme.toggle",
  null,
  "palette.open",
  "settings.open",
  "note.delete",
];

/** Layout entries that stand for something other than a single command. */
export const TOOLBAR_SLOTS = ["TITLE", "ALIGN"];

import type { ContextMenuItem } from "@/lib/context-menu";

/**
 * Re-presents a registry command as a context-menu row.
 *
 * Labels, chords and enabled state all come from the one declaration in
 * `APP_COMMANDS`, so a menu can never advertise a binding the app does not
 * actually listen for.
 */
export function commandMenuItem(id: string): ContextMenuItem | null {
  const command = APP_COMMANDS.find((item) => item.id === id);
  if (!command) return null;

  return {
    id,
    label: command.title,
    chord: command.shortcut,
    icon: command.icon,
    disabled: command.enabled ? !command.enabled() : false,
    danger: command.danger,
    run: () => void command.run(),
  };
}

/** Drops entries a lookup could not resolve. */
export function presentCommands(items: (ContextMenuItem | null)[]): ContextMenuItem[] {
  return items.filter((item): item is ContextMenuItem => item !== null);
}

/**
 * The alignment group, in left → right order.
 *
 * The top bar renders these from the registry so their labels, chords and
 * enabled state stay in one place, and so the active side can be read off the
 * selection.
 */
export const ALIGN_COMMANDS: { align: Align; command: AppCommand }[] = (
  [
    ["left", "format.alignLeft"],
    ["center", "format.alignCenter"],
    ["right", "format.alignRight"],
  ] as const
)
  .map(([align, id]) => ({ align, command: APP_COMMANDS.find((item) => item.id === id) }))
  .filter(
    (entry): entry is { align: Align; command: AppCommand } => entry.command !== undefined,
  );

/**
 * Whether a key event matches a command's accelerator.
 *
 * Every modifier is compared exactly, so `Ctrl+S` cannot fire for
 * `Ctrl+Shift+S`.
 */
export function accelMatches(accel: Accel, event: KeyboardEvent): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if ((accel.mod ?? false) !== mod) return false;
  if ((accel.shift ?? false) !== event.shiftKey) return false;
  if ((accel.alt ?? false) !== event.altKey) return false;
  if (accel.code) return event.code === accel.code;
  return accel.key !== undefined && event.key.toLowerCase() === accel.key;
}

/** Runs the first command whose accelerator matches, if any. */
export function runMatchingCommand(event: KeyboardEvent): boolean {
  for (const command of APP_COMMANDS) {
    if (!command.accel || !accelMatches(command.accel, event)) continue;
    if (command.enabled && !command.enabled()) return false;
    void command.run();
    // The caller only prevents the default when the command does not need it.
    return !command.keepDefault;
  }
  return false;
}
