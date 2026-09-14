import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";

import { api, errorMessage } from "@/lib/api";
import { useSettings } from "@/stores/settings";
import type { Note, Workspace } from "@/types";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: number | null;

  notes: Note[];
  /**
   * Subfolders of the active workspace, relative paths.
   *
   * The tree could be built from note paths alone, but then an empty folder —
   * exactly what "新建文件夹" produces — would not appear at all.
   */
  folders: string[];
  /**
   * Folders created this session that hold no notes yet.
   *
   * The tree hides any folder whose subtree contains no markdown, so without
   * this exemption a folder the user just made would vanish the moment it
   * appeared. A folder that gains a note no longer needs it; one that never does
   * is gone after a restart, which is the honest outcome.
   */
  pendingFolders: string[];
  activeNoteId: number | null;

  /** Editor buffer for the active note. */
  content: string;
  contentLoaded: boolean;
  /**
   * The version of the open note that was last read from or written to disk.
   *
   * Every save is checked against it, so a file edited in another editor is
   * noticed instead of being overwritten by a buffer that never saw it.
   */
  diskHash: string | null;
  /**
   * Counts the times `content` was replaced from disk rather than typed.
   *
   * The rich-text editor builds itself once from `content` and never re-reads the
   * store, so a reload has to be signalled: the editor watches this and rebuilds
   * on a change. Without it the buffer was reloaded while the screen kept showing
   * the old text — and the next keystroke wrote that stale text back.
   */
  contentEpoch: number;

  saveState: SaveState;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  addWorkspaceFromPicker: () => Promise<void>;
  selectWorkspace: (id: number) => Promise<void>;
  removeWorkspace: (id: number) => Promise<void>;

  selectNote: (id: number) => Promise<void>;
  updateContent: (content: string) => void;
  flushSave: () => Promise<void>;
  closeNote: () => Promise<void>;

  /** Re-reads the open note from disk, discarding the buffer. */
  reloadFromDisk: () => Promise<void>;
  /**
   * 把某一版历史写回去。
   *
   * 这是一次**不检查冲突**的覆盖（用户点的就是「就要这一版」），而后端在写之前
   * 会先给当前这一版记一条历史，所以恢复错了还能再恢复回来。
   */
  restoreRevision: (revisionId: number) => Promise<void>;
  /**
   * 钉一个版本。
   *
   * 先把待写的改动落盘再钉：钉的是**文件里的内容**，不先 flush 的话钉下来的是
   * 上一次保存的样子。返回是否真的新增了一版（与最新一版内容相同时为 `false`）。
   */
  snapshotNow: () => Promise<boolean>;
  /** Writes the buffer over the version that arrived from outside. */
  overwriteFromDisk: () => Promise<void>;
  /**
   * Checks whether the open note's file changed underneath the app.
   *
   * Called on focus and on a slow timer: with nothing unsaved the file is taken
   * as it now is, and with unsaved work the conflict is surfaced instead.
   */
  checkExternalChange: () => Promise<void>;

  createNote: (relPath: string) => Promise<void>;
  /** Creates a folder inside the active workspace; `relDir` may be nested. */
  createFolder: (relDir: string) => Promise<void>;
  /** Renames or moves a folder; every note inside moves with it. */
  renameFolder: (relDir: string, newRelDir: string) => Promise<void>;
  /** Moves a folder to the recycle bin and drops its notes from the index. */
  deleteFolder: (relDir: string) => Promise<void>;
  /** 在系统文件管理器里定位工作区内的一个路径（空字符串代表根目录）。 */
  revealPath: (relPath: string) => Promise<void>;
  renameNote: (id: number, newRelPath: string) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  /** Re-reads the tree without rebuilding the note index. */
  refreshTree: () => Promise<void>;
  /** Rebuilds the note index from disk, picking up files changed outside 青简. */
  rescan: () => Promise<void>;
}

/**
 * Rewrites exempt folder paths after one of them is moved or removed.
 *
 * The exemption is a set of paths, but a folder move carries everything below it
 * along — so a folder whose parent was renamed has to be rewritten too, or
 * renaming an empty folder would be the same as deleting it. `to === null`
 * removes every path under `from`.
 */
function remapPending(pending: string[], from: string, to: string | null): string[] {
  return pending.flatMap((path) => {
    if (path !== from && !path.startsWith(`${from}/`)) return [path];
    if (to === null) return [];
    return [path === from ? to : `${to}${path.slice(from.length)}`];
  });
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Saves run one after another so a slow write can never be overtaken by a
  // newer one, which would leave stale content on disk.
  let saveChain: Promise<void> = Promise.resolve();

  const cancelScheduledSave = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const enqueueSave = (): Promise<void> => {
    saveChain = saveChain.then(async () => {
      const { activeNoteId, content, contentLoaded, saveState } = get();
      if (activeNoteId === null || !contentLoaded) return;

      // A conflict has to be answered before anything is written; retrying it on
      // every keystroke would only keep raising the same one.
      if (saveState === "conflict") return;

      /**
       * Nothing to write unless there is something to write.
       *
       * This runs on every blur, not just after an edit, so writing
       * unconditionally meant touching — and reformatting — a note that had only
       * been opened: the editor's serialisation of a document is not
       * byte-identical to the file it came from, so switching to another program
       * and back silently rewrote it. `error` is included on purpose: a failed
       * write should get another go rather than staying stuck.
       */
      if (saveState !== "dirty" && saveState !== "error") return;

      set({ saveState: "saving" });
      try {
        const outcome = await api.saveNote(activeNoteId, content, get().diskHash);

        if (outcome.status === "conflict") {
          set({
            saveState: "conflict",
            diskHash: outcome.diskHash,
            error: null,
          });
          return;
        }

        set((state) => ({
          notes: state.notes.map((item) =>
            item.id === outcome.note.id ? outcome.note : item,
          ),
          diskHash: outcome.hash,
          saveState: "saved",
          error: null,
        }));
      } catch (error) {
        set({ saveState: "error", error: errorMessage(error) });
      }
    });

    return saveChain;
  };

  const loadNotes = async (workspaceId: number) => {
    const notes = await api.listNotes(workspaceId);
    set({ notes });
    return notes;
  };

  /**
   * Notes plus folders, for whenever the tree can change shape: creating a note
   * or folder, renaming, deleting.
   *
   * Folder listing is best-effort — a workspace whose folders cannot be read
   * still renders its notes.
   */
  const loadTree = async (workspaceId: number) => {
    const [notes, folders] = await Promise.all([
      api.listNotes(workspaceId),
      api.listFolders(workspaceId).catch(() => [] as string[]),
    ]);
    set({ notes, folders });
    return notes;
  };

  /**
   * Notes plus folders, rebuilt from disk.
   *
   * Only for opening a workspace. The note table is exactly as fresh as the last
   * sync, so reading it alone would hide a `.md` that appeared on disk since then
   * (a `git pull`, another editor, a file dragged into the folder) until the user
   * ran a manual rescan. Folders were already scanned live, so the sidebar could
   * otherwise show a folder and a file list that disagreed with each other.
   */
  const syncTree = async (workspaceId: number) => {
    const [notes, folders] = await Promise.all([
      api.syncWorkspace(workspaceId),
      api.listFolders(workspaceId).catch(() => [] as string[]),
    ]);
    set({ notes, folders });
    return notes;
  };

  return {
    workspaces: [],
    activeWorkspaceId: null,
    notes: [],
    folders: [],
    pendingFolders: [],
    activeNoteId: null,
    content: "",
    contentLoaded: false,
    diskHash: null,
    contentEpoch: 0,
    saveState: "idle",
    loading: false,
    error: null,

    init: async () => {
      set({ loading: true, error: null });
      try {
        let workspaces = await api.listWorkspaces();

        // First launch seeds a workspace containing the tour document.
        let seeded = false;
        if (workspaces.length === 0) {
          const created = await api.bootstrapWorkspace();
          if (created) {
            workspaces = await api.listWorkspaces();
            seeded = true;
          }
        }

        set({ workspaces });

        // The welcome note is meant to be seen, so it opens even when the user
        // has turned session restore off.
        const active = workspaces[0];
        if (active && (seeded || useSettings.getState().settings.restoreLastWorkspace)) {
          await get().selectWorkspace(active.id);
        }
      } catch (error) {
        set({ error: errorMessage(error) });
      } finally {
        set({ loading: false });
      }
    },

    addWorkspaceFromPicker: async () => {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;

      set({ loading: true, error: null });
      try {
        const workspace = await api.addWorkspace(picked);
        const workspaces = await api.listWorkspaces();
        set({ workspaces });
        await get().selectWorkspace(workspace.id);
      } catch (error) {
        set({ error: errorMessage(error) });
      } finally {
        set({ loading: false });
      }
    },

    selectWorkspace: async (id) => {
      await get().flushSave();
      set({
        activeWorkspaceId: id,
        activeNoteId: null,
        content: "",
        contentLoaded: false,
        diskHash: null,
        saveState: "idle",
        // The exemptions belong to the workspace that is being left behind.
        pendingFolders: [],
        error: null,
      });

      try {
        const notes = await syncTree(id);
        const first = notes[0];
        if (first) await get().selectNote(first.id);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    removeWorkspace: async (id) => {
      await get().flushSave();
      try {
        await api.removeWorkspace(id);
        const workspaces = await api.listWorkspaces();
        set({
          workspaces,
          activeWorkspaceId: null,
          activeNoteId: null,
          notes: [],
          content: "",
          contentLoaded: false,
        });

        const next = workspaces[0];
        if (next) await get().selectWorkspace(next.id);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    selectNote: async (id) => {
      if (get().activeNoteId === id) return;
      await get().flushSave();

      set({
        activeNoteId: id,
        content: "",
        contentLoaded: false,
        diskHash: null,
        error: null,
      });

      try {
        const detail = await api.readNote(id);
        // A quick second click may have moved on while this read was in flight.
        if (get().activeNoteId !== id) return;

        set((state) => ({
          content: detail.content,
          contentLoaded: true,
          diskHash: detail.hash,
          saveState: "saved",
          notes: state.notes.map((item) =>
            item.id === detail.note.id ? detail.note : item,
          ),
        }));
      } catch (error) {
        if (get().activeNoteId !== id) return;
        set({ error: errorMessage(error), contentLoaded: false });
      }
    },

    updateContent: (content) => {
      // A pending conflict stays a conflict: the file on disk still is not this
      // text, so calling it "dirty" would only invite a save that cannot win.
      const conflicted = get().saveState === "conflict";
      set({ content, saveState: conflicted ? "conflict" : "dirty" });

      cancelScheduledSave();
      if (conflicted) return;

      // With autosave off the document stays dirty until Ctrl+S or a blur.
      const { autoSave, autoSaveDelay } = useSettings.getState().settings;
      if (!autoSave) return;

      saveTimer = setTimeout(() => {
        saveTimer = null;
        void enqueueSave();
      }, autoSaveDelay);
    },

    flushSave: async () => {
      cancelScheduledSave();
      await enqueueSave();
    },

    /// Closes the current document, persisting it first.
    closeNote: async () => {
      await get().flushSave();
      set({
        activeNoteId: null,
        content: "",
        contentLoaded: false,
        diskHash: null,
        saveState: "idle",
      });
    },

    /**
     * 把某一版历史写回去。
     *
     * 顺序很要紧：先取消排队中的自动保存，再覆盖，最后重新读取。若把保存留在
     * 队列里，它会在「写回去」和「读回来」之间发出去，拿编辑器里的旧缓冲把刚
     * 恢复的内容盖掉。
     */
    restoreRevision: async (revisionId) => {
      const id = get().activeNoteId;
      if (id === null) return;

      cancelScheduledSave();
      set({ saveState: "saving" });

      try {
        const outcome = await api.restoreNoteRevision(revisionId);
        if (outcome.status === "conflict") {
          // 后端不做冲突检查，所以冲突在这里不该出现；真出现就直接说出来。
          set({ saveState: "conflict", diskHash: outcome.diskHash });
          return;
        }

        await get().reloadFromDisk();
      } catch (error) {
        set({ saveState: "error", error: errorMessage(error) });
      }
    },

    snapshotNow: async () => {
      const id = get().activeNoteId;
      if (id === null) return false;

      await get().flushSave();
      return api.snapshotNote(id);
    },

    reloadFromDisk: async () => {
      const id = get().activeNoteId;
      if (id === null) return;

      cancelScheduledSave();
      try {
        const detail = await api.readNote(id);
        if (get().activeNoteId !== id) return;

        set((state) => ({
          content: detail.content,
          contentLoaded: true,
          diskHash: detail.hash,
          // Tells the editor to take the new text; see `contentEpoch`.
          contentEpoch: state.contentEpoch + 1,
          saveState: "saved",
          error: null,
          notes: state.notes.map((item) =>
            item.id === detail.note.id ? detail.note : item,
          ),
        }));
      } catch (error) {
        if (get().activeNoteId !== id) return;
        set({ error: errorMessage(error), contentLoaded: false });
      }
    },

    overwriteFromDisk: async () => {
      const { activeNoteId, content } = get();
      if (activeNoteId === null) return;

      set({ saveState: "saving" });
      try {
        // No expected hash: this is the deliberate answer to the conflict.
        const outcome = await api.saveNote(activeNoteId, content, null);
        if (outcome.status === "conflict") {
          set({ saveState: "conflict", diskHash: outcome.diskHash });
          return;
        }

        set((state) => ({
          notes: state.notes.map((item) =>
            item.id === outcome.note.id ? outcome.note : item,
          ),
          diskHash: outcome.hash,
          saveState: "saved",
          error: null,
        }));
      } catch (error) {
        set({ saveState: "error", error: errorMessage(error) });
      }
    },

    checkExternalChange: async () => {
      const { activeNoteId, contentLoaded, diskHash, saveState } = get();
      if (activeNoteId === null || !contentLoaded) return;
      // Nothing can be decided while a write of our own is in flight.
      if (saveState === "saving" || saveState === "conflict") return;

      try {
        const current = await api.noteHash(activeNoteId);
        if (current === null || current === diskHash) return;
        if (get().activeNoteId !== activeNoteId) return;

        // Unsaved work of our own: both versions exist and only the user can
        // say which one wins.
        if (get().saveState === "dirty") {
          set({ saveState: "conflict", diskHash: current });
          return;
        }

        // Nothing unsaved, so the file wins — which is what someone editing it
        // in another program expects to see when they come back.
        await get().reloadFromDisk();
      } catch {
        // A check that cannot run is not worth interrupting the user over; the
        // next save still refuses to clobber an unseen version.
      }
    },

    createNote: async (relPath) => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      try {
        const note = await api.createNote(workspaceId, relPath);
        await loadTree(workspaceId);
        await get().selectNote(note.id);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    createFolder: async (relDir) => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      try {
        const created = await api.createFolder(workspaceId, relDir);
        const folders = await api.listFolders(workspaceId);
        set((state) => ({
          folders,
          // Only the folder that was made is exempt, not the folders above it:
          // the tree already keeps a folder that leads to a kept child.
          pendingFolders: [...state.pendingFolders, created],
          error: null,
        }));
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    renameFolder: async (relDir, newRelDir) => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      try {
        const moved = await api.renameFolder(workspaceId, relDir, newRelDir);
        set((state) => ({
          pendingFolders: remapPending(state.pendingFolders, relDir, moved),
        }));
        // The open note's own path may have changed underneath it; the tree is
        // re-read so the sidebar and the note list agree with the disk.
        await loadTree(workspaceId);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    deleteFolder: async (relDir) => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      // The open note may be inside that folder. Cancelling the scheduled save
      // first is what stops the buffer from being written back a moment later,
      // which would recreate the file that was just deleted.
      cancelScheduledSave();

      try {
        await api.deleteFolder(workspaceId, relDir);
        set((state) => ({ pendingFolders: remapPending(state.pendingFolders, relDir, null) }));
        const notes = await loadTree(workspaceId);

        const activeId = get().activeNoteId;
        if (activeId !== null && !notes.some((note) => note.id === activeId)) {
          // Cleared directly rather than through `closeNote`, which would flush
          // the buffer to a path that no longer exists.
          set({
            activeNoteId: null,
            content: "",
            contentLoaded: false,
            diskHash: null,
            saveState: "idle",
          });
          const next = notes[0];
          if (next) await get().selectNote(next.id);
        }
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    revealPath: async (relPath) => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      try {
        await api.revealInWorkspace(workspaceId, relPath);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    renameNote: async (id, newRelPath) => {
      try {
        await api.renameNote(id, newRelPath);
        const workspaceId = get().activeWorkspaceId;
        // A rename can move the file into a folder that did not exist yet.
        if (workspaceId !== null) await loadTree(workspaceId);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    /**
     * Re-reads the tree without rebuilding the index.
     *
     * The cheap half of `rescan`: the note table is read as-is, so this only
     * picks up what the app itself changed. The alternative is worth offering
     * because reindexing walks the whole folder, which is the expensive half on
     * a large workspace.
     */
    refreshTree: async () => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      try {
        await loadTree(workspaceId);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    /**
     * Rebuilds the note index from disk, picking up files added or removed
     * outside the app. Flushes first: the index is about to be rebuilt from
     * what is on disk, so the buffer must be on disk too.
     */
    rescan: async () => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      await get().flushSave();

      try {
        const notes = await syncTree(workspaceId);

        if (get().activeNoteId === null && notes[0]) {
          await get().selectNote(notes[0].id);
        }
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    deleteNote: async (id) => {
      try {
        await api.deleteNote(id);
        const workspaceId = get().activeWorkspaceId;
        if (workspaceId !== null) await loadNotes(workspaceId);

        if (get().activeNoteId === id) {
          const next = get().notes[0];
          set({ activeNoteId: null, content: "", contentLoaded: false });
          if (next) await get().selectNote(next.id);
        }
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },
  };
});
