import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { EditorPane } from "@/components/editor/EditorPane";
import { ExportDialog } from "@/components/editor/ExportDialog";
import { FrontMatterDialog } from "@/components/editor/FrontMatterDialog";
import { NoteHistoryDialog } from "@/components/editor/NoteHistoryDialog";
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
import { runMatchingCommand, openPathFromDisk } from "@/lib/commands";
import { useThemeSync } from "@/lib/theme";
import { checkForUpdates, type Update } from "@/lib/update";
import { defaultSettings, useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useUpdate } from "@/stores/update";
import { useWorkspace } from "@/stores/workspace";

import { UpdateDialog } from "./components/update/UpdateDialog";

/** Bounds for the sidebar drag handle, matching the settings slider. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
/** Bounds for the outline / info panel's drag handle. */
const OUTLINE_MIN = 180;
const OUTLINE_MAX = 560;

export default function App() {
  const settingsLoaded = useSettings((state) => state.loaded);
  const settingsError = useSettings((state) => state.error);
  const loadSettings = useSettings((state) => state.load);
  const sidebarWidth = useSettings((state) => state.settings.sidebarWidth);
  const infoWidth = useSettings((state) => state.settings.infoWidth);
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
  const renamingFolder = useUi((state) => state.renamingFolder);
  const setRenamingFolder = useUi((state) => state.setRenamingFolder);
  const pendingDeleteFolder = useUi((state) => state.pendingDeleteFolder);
  const setPendingDeleteFolder = useUi((state) => state.setPendingDeleteFolder);

  const initWorkspace = useWorkspace((state) => state.init);
  const flushSave = useWorkspace((state) => state.flushSave);
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const rescan = useWorkspace((state) => state.rescan);
  const saveState = useWorkspace((state) => state.saveState);
  const checkExternalChange = useWorkspace((state) => state.checkExternalChange);
  const reloadFromDisk = useWorkspace((state) => state.reloadFromDisk);
  const overwriteFromDisk = useWorkspace((state) => state.overwriteFromDisk);
  const deleteNote = useWorkspace((state) => state.deleteNote);
  const renameNote = useWorkspace((state) => state.renameNote);
  const renameFolder = useWorkspace((state) => state.renameFolder);
  const deleteFolder = useWorkspace((state) => state.deleteFolder);

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

  /** A folder path split into its parent and its own name. */
  const folderParts = (path: string) => {
    const index = path.lastIndexOf("/");
    return {
      parent: index > 0 ? path.slice(0, index) : "",
      name: index > 0 ? path.slice(index + 1) : path,
    };
  };

  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  /** 后台查到的新版本；非空时弹窗，用户可以选「立即更新」或「稍后再说」。 */
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);

  const [dragging, setDragging] = useState<{ panel: "sidebar" | "outline"; width: number } | null>(
    null,
  );

  useThemeSync();

  useEffect(() => {
    void (async () => {
      // Settings first: the layout and autosave behaviour depend on them.
      await loadSettings();
      await initWorkspace();
      // Read after the workspace is up, so a rebuilt index is already reflected.
      setStartupNotice(await api.takeStartupNotice().catch(() => null));

      // 双击 .md 启动时，文件路径是命令行给的。放在最后取：这时工作区已经
      // 就绪，「认领文件所在目录」那套逻辑才跑得起来。
      const requested = await api.takeOpenFile().catch(() => null);
      if (requested) await openPathFromDisk(requested);

      // 更新检查排在最后，而且刻意不拦住启动：它要联网，慢起来无上限。
      // 从 store 现读设置，因为上面那次 await 之后 loadSettings 才刚写完值。
      if (!useSettings.getState().settings.autoCheckUpdate) return;
      try {
        const found = await checkForUpdates(useSettings.getState().settings.updateProxy);
        useSettings.getState().update("lastUpdateCheck", new Date().toISOString());
        if (found) {
          setPendingUpdate(found);
          setUpdateOpen(true);
        }
      } catch {
        // 后台检查失败不打扰用户；设置里的手动检查会把原因说出来。
      }
    })();
  }, [loadSettings, initWorkspace]);

  /**
   * 青简已经在跑的时候又去双击一个 `.md`。
   *
   * 那一份进程由 `tauri-plugin-single-instance` 直接劝退，命令行交给这里的
   * 主进程（见 `lib.rs` 的 `hand_over_second_launch`），主进程再发一个事件
   * 让我们去取。取的路径和开机时那次是同一段逻辑，不开第二个窗口。
   */
  useEffect(() => {
    let stop: (() => void) | null = null;
    let disposed = false;

    void listen("open-file-request", async () => {
      const requested = await api.takeOpenFile().catch(() => null);
      if (requested) await openPathFromDisk(requested);
    })
      .then((unlisten) => {
        // 监听是在事件发出去之前就绪，还是之后，取决于两边谁先跑完，所以等到
        // 组件已经卸下来时得把迟到的那个取消掉，否则会泄漏。
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        // 事件通道不可用只意味着「转交」少一条路，开机那次打开不受影响。
      });

    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (settingsLoaded && isSidebarOpen === null) setSidebarOpen(showSidebar);
  }, [settingsLoaded, showSidebar, isSidebarOpen, setSidebarOpen]);

  /**
   * 更新已经下好、而用户直接关软件时，顺手把更新装上。
   *
   * 这次传 `restartAfterInstall: false`：用户是在关它，不是在重启它，不该替他
   * 把窗口再拉起来。真正退出是 `install` 内部启动安装程序后 `exit` 本进程；
   * `destroy` 是万一它没走到那一步的退路。
   *
   * 这里一旦 `preventDefault`，窗口的关闭就只能由本函数负责到底：`@tauri-apps`
   * 的默认处理不会再搭手。所以每条分支都要保证窗口最后真的关掉——处理器里抛出的
   * 异常同样会跳过默认销毁，把人卡在一个关不掉的窗口里。
   */
  useEffect(() => {
    const current = getCurrentWindow();
    let takingOver = false;

    const unlisten = current.onCloseRequested(async (event) => {
      if (takingOver) return;

      const { staged, installing } = useUpdate.getState();
      // 没有待安装的更新，或安装已经在跑：什么都不做，交给默认处理关窗。
      if (!staged || installing) return;

      takingOver = true;
      event.preventDefault();

      // 安装程序万一没把进程带走（它本该 `exit`），也别让窗口留在这里：
      // 超时后强制关闭。正常安装走不到这一步。
      const watchdog = window.setTimeout(() => void current.destroy(), 15_000);
      try {
        await useWorkspace.getState().flushSave();
        await staged.install({ restartAfterInstall: false });
      } catch {
        // 装不上就照常关，别把用户卡在开着的窗口里
        useUpdate.getState().clear();
      } finally {
        window.clearTimeout(watchdog);
        void current.destroy();
      }
    });

    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

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
    const onBlur = () => {
      void flushSave();
      // A settings change made a moment ago may still be waiting to be written.
      useSettings.getState().flushWrites();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [flushSave]);

  /**
   * Watches the folder as well as the note.
   *
   * A note added, renamed or deleted in another program has to show up in the
   * tree on its own. The fingerprint is a directory walk on the Rust side — no
   * note is read — so polling it is cheap, and the reindex it triggers only runs
   * when the tree really moved.
   *
   * The first answer is only recorded: a workspace that was just opened has
   * already been indexed by `init`.
   */
  useEffect(() => {
    if (activeWorkspaceId === null) return;

    let seen: string | null = null;

    const check = async () => {
      try {
        const signature = await api.workspaceSignature(activeWorkspaceId);
        if (seen === null) {
          seen = signature;
          return;
        }
        if (signature === seen) return;

        seen = signature;
        await rescan();
      } catch {
        // An unreadable folder is not worth interrupting the user over; the next
        // tick tries again, and the sidebar keeps the tree it already has.
      }
    };

    void check();
    const timer = window.setInterval(check, 3000);
    return () => window.clearInterval(timer);
  }, [activeWorkspaceId, rescan]);

  /**
   * Watches the open note for a write from another program.
   *
   * There is no file-system watcher: one hash of a file the app already has open
   * is enough to tell, and it needs no background thread. Regaining focus is
   * checked straight away because that is exactly when an edit made elsewhere has
   * just happened — switching back from the other editor reloads at once. The
   * timer is for a window that stayed in front the whole time, and is short
   * enough to read as live without hashing the file more than a few times a
   * second at worst.
   */
  useEffect(() => {
    const check = () => void checkExternalChange();

    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 2000);
    return () => {
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [checkExternalChange]);

  /**
   * 拖动分栏边框。
   *
   * 拖动过程中宽度只留在本地，松手时才写设置——也就只在松手时写一次库。侧栏在
   * 左边、大纲在右边，所以同一个位移在两个方向上含义相反。
   */
  const startResize = (
    event: React.MouseEvent,
    panel: "sidebar" | "outline",
    from: number,
    min: number,
    max: number,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const direction = panel === "sidebar" ? 1 : -1;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX) * direction;
      setDragging({ panel, width: Math.min(max, Math.max(min, from + delta)) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      // 从 updater 里读当前值：`setDragging(null)` 之后就没有它了。
      setDragging((current) => {
        if (current) {
          updateSetting(current.panel === "sidebar" ? "sidebarWidth" : "infoWidth", current.width);
        }
        return null;
      });
    };

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /**
   * 双击分栏边框回到默认宽度。
   *
   * 拖窄了之后想拖回原样得靠眼神对齐，而默认值是有一个的；这是编辑器里常见的
   * 那个手势（VS Code、开发者工具都是双击）。
   */
  const resetWidth = (panel: "sidebar" | "outline") => {
    updateSetting(
      panel === "sidebar" ? "sidebarWidth" : "infoWidth",
      panel === "sidebar" ? defaultSettings.sidebarWidth : defaultSettings.infoWidth,
    );
  };

  if (!settingsLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        正在启动…
      </div>
    );
  }

  const sidebarVisible = isSidebarOpen ?? showSidebar;
  const sidebarWidthNow = dragging?.panel === "sidebar" ? dragging.width : sidebarWidth;
  const infoWidthNow = dragging?.panel === "outline" ? dragging.width : infoWidth;

  return (
    <div className="qj-root flex h-full overflow-hidden bg-background text-foreground">
      {sidebarVisible && (
        <>
          <Sidebar width={sidebarWidthNow} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
            className={cn("qj-resizer", dragging?.panel === "sidebar" && "qj-resizer--active")}
            onMouseDown={(event) => startResize(event, "sidebar", sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)}
            onDoubleClick={() => resetWidth("sidebar")}
          />
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {settingsError && (
          <div className="shrink-0 border-b border-border/80 bg-danger-soft px-3 py-1.5 text-xs text-danger-soft-foreground">
            设置读取失败，正在使用默认设置：{settingsError}
          </div>
        )}

        {/* Shown once, when the database had to be rebuilt at startup. */}
        {startupNotice && (
          <div className="flex shrink-0 items-start gap-3 border-b border-border/80 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
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
          <div className="flex shrink-0 items-start gap-3 border-b border-border/80 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
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
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="调整大纲宽度"
                className={cn("qj-resizer", dragging?.panel === "outline" && "qj-resizer--active")}
                onMouseDown={(event) =>
                  startResize(event, "outline", infoWidth, OUTLINE_MIN, OUTLINE_MAX)
                }
                onDoubleClick={() => resetWidth("outline")}
              />
              <aside
                className="qj-paper shrink-0 overflow-y-auto border-l border-border/80"
                style={{ width: infoWidthNow }}
              >
                <Outline />
              </aside>
            </>
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
      <NoteHistoryDialog />

      {/* 查到新版本时弹出来。后台检查同样是走这里，只是不阻塞启动。 */}
      {pendingUpdate && (
        <UpdateDialog isOpen={updateOpen} onOpenChange={setUpdateOpen} update={pendingUpdate} />
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

      {/* Folders get the same pair of dialogs as notes: a rename reuses the path
          dialog in folder mode, and deleting asks first. */}
      <NotePathDialog
        isOpen={renamingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingFolder(null);
        }}
        heading="重命名文件夹"
        confirmLabel="重命名"
        kind="folder"
        initialFolder={renamingFolder ? folderParts(renamingFolder).parent : ""}
        initialTitle={renamingFolder ? folderParts(renamingFolder).name : ""}
        onSubmit={(relDir) => {
          if (renamingFolder) void renameFolder(renamingFolder, relDir);
        }}
      />

      <ConfirmDialog
        isOpen={pendingDeleteFolder !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteFolder(null);
        }}
        title="删除这个文件夹？"
        description={
          pendingDeleteFolder
            ? `“${pendingDeleteFolder}” 和里面的所有笔记会移入系统回收站，之后仍可从回收站还原。`
            : ""
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (pendingDeleteFolder) void deleteFolder(pendingDeleteFolder);
        }}
      />
    </div>
  );
}
