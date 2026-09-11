import { create } from "zustand";

import type { Align } from "@/lib/editor/align";
import type { SettingsSection } from "@/lib/settings-sections";
import { useSettings } from "@/stores/settings";

export type SidebarPanel = "files" | "search";

/**
 * Chrome state that more than one component needs to drive: the settings dialog
 * opens from the toolbar, a shortcut, or the help key; the command palette
 * needs to reach every panel; and the find bar is toggled from those too.
 */
interface UiState {
  /** `null` until the stored preference has been applied. */
  isSidebarOpen: boolean | null;
  sidebarPanel: SidebarPanel;
  isNewNoteOpen: boolean;

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
  /** Note awaiting delete confirmation; `null` when no dialog is pending. */
  pendingDeleteNoteId: number | null;
  /** Note being renamed; `null` when no dialog is pending. */
  renamingNoteId: number | null;
  /**
   * Alignment of the block under the caret, or `null` when the caret is not in
   * an alignable block (inside a list, say). The top bar reads it to mark the
   * active side.
   */
  blockAlign: Align | null;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  showSidebarPanel: (panel: SidebarPanel) => void;
  setNewNoteOpen: (open: boolean) => void;

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
  setPendingDeleteNoteId: (id: number | null) => void;
  setRenamingNoteId: (id: number | null) => void;
  setBlockAlign: (align: Align | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  isSidebarOpen: null,
  sidebarPanel: "files",
  isNewNoteOpen: false,

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
  pendingDeleteNoteId: null,
  renamingNoteId: null,
  blockAlign: null,

  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),

  toggleSidebar: () => {
    const stored = useSettings.getState().settings.showSidebar;
    set({ isSidebarOpen: !(get().isSidebarOpen ?? stored) });
  },

  showSidebarPanel: (sidebarPanel) => set({ sidebarPanel, isSidebarOpen: true }),
  setNewNoteOpen: (isNewNoteOpen) => set({ isNewNoteOpen }),

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
  setPendingDeleteNoteId: (pendingDeleteNoteId) => set({ pendingDeleteNoteId }),
  setRenamingNoteId: (renamingNoteId) => set({ renamingNoteId }),
  setBlockAlign: (blockAlign) =>
    set((state) => (state.blockAlign === blockAlign ? state : { blockAlign })),
}));
