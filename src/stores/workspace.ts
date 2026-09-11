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
  renameNote: (id: number, newRelPath: string) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  rescan: () => Promise<void>;
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
      const { activeNoteId, content } = get();
      if (activeNoteId === null) return;

      // A conflict has to be answered before anything is written; retrying it on
      // every keystroke would only keep raising the same one.
      if (get().saveState === "conflict") return;

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

  return {
    workspaces: [],
    activeWorkspaceId: null,
    notes: [],
    activeNoteId: null,
    content: "",
    contentLoaded: false,
    diskHash: null,
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
        error: null,
      });

      try {
        const notes = await loadNotes(id);
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
        await loadNotes(workspaceId);
        await get().selectNote(note.id);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    renameNote: async (id, newRelPath) => {
      try {
        const note = await api.renameNote(id, newRelPath);
        set((state) => ({
          notes: state.notes.map((item) => (item.id === note.id ? note : item)),
        }));
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    /// Re-reads the workspace folder from disk, picking up files added or
    /// removed outside the app.
    rescan: async () => {
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId === null) return;

      await get().flushSave();

      try {
        const notes = await api.syncWorkspace(workspaceId);
        set({ notes });

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
