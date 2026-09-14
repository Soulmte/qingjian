import { create } from "zustand";

import type { Align } from "@/lib/editor/align";
import type { SettingsSection } from "@/lib/settings-sections";
import { useSettings } from "@/stores/settings";
import type { SearchHit } from "@/types";

/**
 * Chrome state that more than one component needs to drive: the settings dialog
 * opens from the toolbar, a shortcut, or the help key; the command palette
 * needs to reach every panel; and the find bar is toggled from those too.
 */
interface UiState {
  /** `null` until the stored preference has been applied. */
  isSidebarOpen: boolean | null;
  /**
   * What the sidebar's search box found, or `null` when it is empty.
   *
   * The hits narrow the file tree rather than living in a panel of their own:
   * keeping the matches in place shows the folders they sit in, which a flat list
   * of paths cannot. `null` is what makes the tree show everything.
   */
  searchHits: SearchHit[] | null;
  isNewNoteOpen: boolean;
  isNewFolderOpen: boolean;
  /**
   * Folder the next create dialog starts in; `""` is the workspace root.
   *
   * Set by the sidebar's context menus so "新建笔记 / 新建文件夹" from a folder row
   * lands inside that folder instead of at the root.
   */
  newEntryFolder: string;

  isSettingsOpen: boolean;
  settingsSection: SettingsSection;

  isFindOpen: boolean;
  findShowsReplace: boolean;
  isPaletteOpen: boolean;
  /** Raw Markdown editing instead of the WYSIWYG surface. */
  isSourceMode: boolean;
  isQuickOpen: boolean;
  /** The export dialog, which asks for a format before anything is written. */
  isExportOpen: boolean;
  /** The YAML front matter editor. */
  isFrontMatterOpen: boolean;
  /** 跳转到标题 / 行。 */
  isGoToOpen: boolean;
  /** 要看历史版本的笔记；`null` 时对话框不显示。 */
  historyNoteId: number | null;
  /** Note awaiting delete confirmation; `null` when no dialog is pending. */
  pendingDeleteNoteId: number | null;
  /** Note being renamed; `null` when no dialog is pending. */
  renamingNoteId: number | null;
  /** Folder being renamed (workspace-relative); `null` when none. */
  renamingFolder: string | null;
  /** Folder awaiting delete confirmation; `null` when none. */
  pendingDeleteFolder: string | null;
  /**
   * Alignment of the block under the caret, or `null` when the caret is not in
   * an alignable block (inside a list, say). The top bar reads it to mark the
   * active side.
   */
  blockAlign: Align | null;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSearchHits: (hits: SearchHit[] | null) => void;
  setNewNoteOpen: (open: boolean) => void;
  setNewFolderOpen: (open: boolean) => void;
  /** Opens the "new note" dialog, optionally scoped to a folder. */
  openNewNote: (folder?: string) => void;
  /** Opens the "new folder" dialog, optionally scoped to a parent folder. */
  openNewFolder: (folder?: string) => void;

  setSettingsOpen: (open: boolean) => void;
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;

  openFind: (withReplace?: boolean) => void;
  setFindShowsReplace: (show: boolean) => void;
  closeFind: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleSourceMode: () => void;
  setQuickOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setFrontMatterOpen: (open: boolean) => void;
  setGoToOpen: (open: boolean) => void;
  setHistoryNoteId: (id: number | null) => void;
  setPendingDeleteNoteId: (id: number | null) => void;
  setRenamingNoteId: (id: number | null) => void;
  setRenamingFolder: (path: string | null) => void;
  setPendingDeleteFolder: (path: string | null) => void;
  setBlockAlign: (align: Align | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  isSidebarOpen: null,
  searchHits: null,
  isNewNoteOpen: false,
  isNewFolderOpen: false,
  newEntryFolder: "",

  isSettingsOpen: false,
  settingsSection: "appearance",

  isFindOpen: false,
  findShowsReplace: false,
  isPaletteOpen: false,
  isSourceMode: false,
  isQuickOpen: false,
  isExportOpen: false,
  isFrontMatterOpen: false,
  isGoToOpen: false,
  historyNoteId: null,
  pendingDeleteNoteId: null,
  renamingNoteId: null,
  renamingFolder: null,
  pendingDeleteFolder: null,
  blockAlign: null,

  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),

  toggleSidebar: () => {
    const stored = useSettings.getState().settings.showSidebar;
    set({ isSidebarOpen: !(get().isSidebarOpen ?? stored) });
  },

  setSearchHits: (searchHits) => set({ searchHits }),
  setNewNoteOpen: (isNewNoteOpen) => set({ isNewNoteOpen }),
  setNewFolderOpen: (isNewFolderOpen) => set({ isNewFolderOpen }),
  openNewNote: (newEntryFolder = "") => set({ isNewNoteOpen: true, newEntryFolder }),
  openNewFolder: (newEntryFolder = "") => set({ isNewFolderOpen: true, newEntryFolder }),

  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  openSettings: (settingsSection = "appearance") =>
    set({ isSettingsOpen: true, settingsSection }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),

  openFind: (findShowsReplace = false) => set({ isFindOpen: true, findShowsReplace }),
  setFindShowsReplace: (findShowsReplace) => set({ findShowsReplace }),
  closeFind: () => set({ isFindOpen: false, findShowsReplace: false }),
  setPaletteOpen: (isPaletteOpen) => set({ isPaletteOpen }),
  toggleSourceMode: () => set((state) => ({ isSourceMode: !state.isSourceMode })),
  setQuickOpen: (isQuickOpen) => set({ isQuickOpen }),
  setExportOpen: (isExportOpen) => set({ isExportOpen }),
  setFrontMatterOpen: (isFrontMatterOpen) => set({ isFrontMatterOpen }),
  setGoToOpen: (isGoToOpen) => set({ isGoToOpen }),
  setHistoryNoteId: (historyNoteId) => set({ historyNoteId }),
  setPendingDeleteNoteId: (pendingDeleteNoteId) => set({ pendingDeleteNoteId }),
  setRenamingNoteId: (renamingNoteId) => set({ renamingNoteId }),
  setRenamingFolder: (renamingFolder) => set({ renamingFolder }),
  setPendingDeleteFolder: (pendingDeleteFolder) => set({ pendingDeleteFolder }),
  setBlockAlign: (blockAlign) =>
    set((state) => (state.blockAlign === blockAlign ? state : { blockAlign })),
}));
