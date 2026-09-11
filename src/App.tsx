import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

import { EditorPane } from "@/components/editor/EditorPane";
import { ExportDialog } from "@/components/editor/ExportDialog";
import { FrontMatterDialog } from "@/components/editor/FrontMatterDialog";
import { StatusBar } from "@/components/editor/StatusBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { GoToHeading } from "@/components/palette/GoToHeading";
import { QuickOpen } from "@/components/palette/QuickOpen";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { NotePathDialog } from "@/components/sidebar/NotePathDialog";
import { Outline } from "@/components/sidebar/Outline";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { runMatchingCommand } from "@/lib/commands";
import { useThemeSync } from "@/lib/theme";
import { checkForUpdates } from "@/lib/update";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { UpdateInfo } from "@/types";

import { UpdateDialog } from "./components/update/UpdateDialog";

/** Bounds for the sidebar drag handle, matching the settings slider. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;

export default function App() {
  const settingsLoaded = useSettings((state) => state.loaded);
  const settingsError = useSettings((state) => state.error);
  const loadSettings = useSettings((state) => state.load);
  const sidebarWidth = useSettings((state) => state.settings.sidebarWidth);
  const showOutline = useSettings((state) => state.settings.showOutline);
  const showSidebar = useSettings((state) => state.settings.showSidebar);
  const zoom = useSettings((state) => state.settings.zoom);
  const updateSetting = useSettings((state) => state.update);

  const isSidebarOpen = useUi((state) => state.isSidebarOpen);
  const setSidebarOpen = useUi((state) => state.setSidebarOpen);
  const pendingDeleteNoteId = useUi((state) => state.pendingDeleteNoteId);
  const setPendingDeleteNoteId = useUi((state) => state.setPendingDeleteNoteId);
  const renamingNoteId = useUi((state) => state.renamingNoteId);
  const setRenamingNoteId = useUi((state) => state.setRenamingNoteId);

  const initWorkspace = useWorkspace((state) => state.init);
  const flushSave = useWorkspace((state) => state.flushSave);
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const saveState = useWorkspace((state) => state.saveState);
  const checkExternalChange = useWorkspace((state) => state.checkExternalChange);
  const reloadFromDisk = useWorkspace((state) => state.reloadFromDisk);
  const overwriteFromDisk = useWorkspace((state) => state.overwriteFromDisk);
  const deleteNote = useWorkspace((state) => state.deleteNote);
  const renameNote = useWorkspace((state) => state.renameNote);

  const pendingDelete = notes.find((item) => item.id === pendingDeleteNoteId) ?? null;
  const renaming = notes.find((item) => item.id === renamingNoteId) ?? null;
  const conflicted = notes.find((item) => item.id === activeNoteId) ?? null;

  /** Notes are addressed by `folder/name.md`; rename works in those terms. */
  const renameParts = (relPath: string) => {
    const withoutExtension = relPath.replace(/\.md$/i, "");
    const index = withoutExtension.lastIndexOf("/");
    return {
      folder: index > 0 ? withoutExtension.slice(0, index) : "",
      title: index > 0 ? withoutExtension.slice(index + 1) : withoutExtension,
    };
  };

  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  /** 后台查到的新版本；非空时弹窗，用户可以选「立即更新」或「稍后再说」。 */
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);

  const [dragWidth, setDragWidth] = useState<number | null>(null);

  useThemeSync();

  useEffect(() => {
    void (async () => {
      // Settings first: the layout and autosave behaviour depend on them.
      await loadSettings();
      await initWorkspace();
      // Read after the workspace is up, so a rebuilt index is already reflected.
      setStartupNotice(await api.takeStartupNotice().catch(() => null));

      // 更新检查排在最后，而且刻意不拦住启动：它要联网，慢起来无上限。
      // 从 store 现读设置，因为上面那次 await 之后 loadSettings 才刚写完值。
      if (!useSettings.getState().settings.autoCheckUpdate) return;
      try {
        const info = await checkForUpdates();
        useSettings.getState().update("lastUpdateCheck", new Date().toISOString());
        if (info.updateAvailable) {
          setUpdateInfo(info);
          setUpdateOpen(true);
        }
      } catch {
        // 后台检查失败不打扰用户；设置里的手动检查会把原因说出来。
      }
    })();
  }, [loadSettings, initWorkspace]);

  useEffect(() => {
    if (settingsLoaded && isSidebarOpen === null) setSidebarOpen(showSidebar);
  }, [settingsLoaded, showSidebar, isSidebarOpen, setSidebarOpen]);

  // Zoom lives in the webview, so restoring a stored value (and keeping the
  // window in step with the shortcut) has to go through it rather than CSS.
  useEffect(() => {
    if (!settingsLoaded) return;
    void getCurrentWebview()
      .setZoom(zoom)
      .catch(() => undefined);
  }, [zoom, settingsLoaded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An IME composition owns the keystroke; acting on it would swallow the
      // character the user is composing.
      if (event.isComposing) return;
      if (runMatchingCommand(event)) event.preventDefault();
    };

    // Leaving the window is the last reliable moment to persist the buffer.
    const onBlur = () => void flushSave();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [flushSave]);

  /**
   * Watches the open note for a write from another program.
   *
   * There is no file-system watcher: one hash of a file the app already has open
   * is enough to tell, and it needs no background thread. Regaining focus is
   * checked straight away because that is exactly when an edit made elsewhere has
   * just happened; the timer covers a window that stayed in front the whole time.
   */
  useEffect(() => {
    const check = () => void checkExternalChange();

    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 5000);
    return () => {
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [checkExternalChange]);

  /**
   * Drags the divider between the sidebar and the editor. The width is kept
   * local while dragging so the setting — and therefore SQLite — is only
   * written once, on release.
   */
  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startWidth + moveEvent.clientX - startX),
      );
      setDragWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      setDragWidth((value) => {
        if (value !== null) updateSetting("sidebarWidth", value);
        return null;
      });
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!settingsLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        正在启动…
      </div>
    );
  }

  const sidebarVisible = isSidebarOpen ?? showSidebar;
  const effectiveWidth = dragWidth ?? sidebarWidth;

  return (
    <div className="qj-root flex h-full overflow-hidden bg-background text-foreground">
      {sidebarVisible && (
        <>
          <Sidebar width={effectiveWidth} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
            className={cn("qj-resizer", dragWidth !== null && "qj-resizer--active")}
            onMouseDown={startResize}
          />
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {settingsError && (
          <div className="shrink-0 border-b border-border/60 bg-danger-soft px-3 py-1.5 text-xs text-danger-soft-foreground">
            设置读取失败，正在使用默认设置：{settingsError}
          </div>
        )}

        {/* Shown once, when the database had to be rebuilt at startup. */}
        {startupNotice && (
          <div className="flex shrink-0 items-start gap-3 border-b border-border/60 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
            <p className="min-w-0 flex-1 whitespace-pre-line">{startupNotice}</p>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-0.5 hover:bg-default/60"
              onClick={() => setStartupNotice(null)}
            >
              知道了
            </button>
          </div>
        )}

        {/* The file changed under the app and there is unsaved work of our own,
            so only the user can say which version survives. */}
        {saveState === "conflict" && (
          <div className="flex shrink-0 items-start gap-3 border-b border-border/60 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
            <p className="min-w-0 flex-1">
              「{conflicted?.relPath ?? "当前笔记"}」已被其它程序修改，为避免覆盖，本次保存已暂停。
            </p>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-0.5 font-medium hover:bg-default/60"
              onClick={() => void overwriteFromDisk()}
            >
              保留我的版本
            </button>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-0.5 hover:bg-default/60"
              onClick={() => void reloadFromDisk()}
            >
              重新载入文件
            </button>
          </div>
        )}

        <TopBar />

        <div className="flex min-h-0 flex-1">
          <div className="qj-paper min-w-0 flex-1">
            <EditorPane />
          </div>

          {showOutline && (
            <aside className="qj-paper w-60 shrink-0 overflow-y-auto border-l border-border/60">
              <Outline />
            </aside>
          )}
        </div>

        <StatusBar />
      </main>

      <SettingsDialog />
      <CommandPalette />
      <QuickOpen />
      <GoToHeading />
      <ContextMenu />
      <ExportDialog />
      <FrontMatterDialog />

      {/* 查到新版本时弹出来。后台检查同样是走这里，只是不阻塞启动。 */}
      {updateInfo && (
        <UpdateDialog isOpen={updateOpen} onOpenChange={setUpdateOpen} info={updateInfo} />
      )}

      <NotePathDialog
        isOpen={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingNoteId(null);
        }}
        heading="重命名笔记"
        confirmLabel="重命名"
        initialFolder={renaming ? renameParts(renaming.relPath).folder : ""}
        initialTitle={renaming ? renameParts(renaming.relPath).title : ""}
        onSubmit={(relPath) => {
          if (renaming) void renameNote(renaming.id, relPath);
        }}
      />

      {/* Deleting is destructive and confirmable, so the confirmation lives
          here rather than inside the toolbar that requests it. */}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteNoteId(null);
        }}
        title="删除这篇笔记？"
        description={
          pendingDelete
            ? `“${pendingDelete.relPath}” 会移入系统回收站，之后仍可从回收站还原。`
            : ""
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (pendingDelete) void deleteNote(pendingDelete.id);
        }}
      />
    </div>
  );
}
