import { describe, expect, it } from "vitest";

import { menuItems } from "@/lib/context-menu";
import { buildCreateMenu, buildFolderMenu, buildNoteMenu, buildReloadMenu } from "@/lib/note-menu";
import { useUi } from "@/stores/ui";
import type { Note } from "@/types";

function note(relPath: string): Note {
  return {
    id: 1,
    workspaceId: 1,
    relPath,
    title: relPath,
    contentHash: null,
    pinned: false,
    isDeleted: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const ids = (entries: Parameters<typeof menuItems>[0]) =>
  menuItems(entries).map((item) => item.id);

/**
 * Guards the two workspace rows in the sidebar menus.
 *
 * They are the only way to reach 刷新 / 从磁盘重新加载 outside the command
 * palette, and they are built by looking up registry ids: a typo there yields no
 * row and no error, which is exactly how a menu entry goes missing unnoticed.
 * Asserted by id so relabelling stays free.
 */
describe("folder menu", () => {
  it("offers refresh and reload-from-disk for a folder", () => {
    expect(ids(buildFolderMenu("notes"))).toContain("workspace.refresh");
    expect(ids(buildFolderMenu("notes"))).toContain("workspace.reload");
  });

  it("offers them on the workspace root too", () => {
    // `""` is what the tree's background menu passes.
    expect(ids(buildFolderMenu(""))).toContain("workspace.refresh");
    expect(ids(buildFolderMenu(""))).toContain("workspace.reload");
  });

  it("leaves rows that need a real folder out of the root menu", () => {
    expect(ids(buildFolderMenu(""))).not.toContain("folder.rename");
    expect(ids(buildFolderMenu(""))).not.toContain("folder.copyPath");
    expect(ids(buildFolderMenu(""))).not.toContain("folder.delete");
  });
});

describe("note menu", () => {
  it("offers the workspace rows on a note row in the tree", () => {
    expect(ids(buildNoteMenu(note("a.md"), true))).toContain("workspace.refresh");
    expect(ids(buildNoteMenu(note("a.md"), true))).toContain("workspace.reload");
  });

  it("leaves them out of the editor's note submenu", () => {
    // They act on the folder tree, which is not on screen inside the document.
    expect(ids(buildNoteMenu(note("a.md")))).not.toContain("workspace.refresh");
    expect(ids(buildNoteMenu(note("a.md")))).not.toContain("workspace.reload");
  });

  it("keeps the destructive row last", () => {
    expect(ids(buildNoteMenu(note("a.md"), true)).at(-1)).toBe("note.delete");
  });
});

/**
 * The sidebar's two dropdown buttons.
 *
 * They exist because a sidebar full of files leaves no blank area to
 * right-click, so these rows would otherwise be unreachable exactly when they
 * are needed. Order is asserted too: the pair is read top to bottom.
 */
describe("sidebar dropdowns", () => {
  it("offers a note and a folder, in that order", () => {
    expect(ids(buildCreateMenu())).toEqual(["folder.newNote", "folder.newFolder"]);
  });

  it("offers refresh before reload-from-disk", () => {
    expect(ids(buildReloadMenu())).toEqual(["workspace.refresh", "workspace.reload"]);
  });

  it("creates inside the folder the tree row was on", () => {
    // The row menus pass the folder a new entry belongs in; the sidebar's own
    // dropdown passes nothing, which means the workspace root.
    const captured: (string | undefined)[] = [];
    const { openNewNote, openNewFolder } = useUi.getState();
    useUi.setState({
      openNewNote: (folder) => captured.push(folder),
      openNewFolder: (folder) => captured.push(folder),
    });

    try {
      const rows = menuItems(buildCreateMenu("docs"));
      rows[0].run?.();
      rows[1].run?.();
      expect(captured).toEqual(["docs", "docs"]);
    } finally {
      useUi.setState({ openNewNote, openNewFolder });
    }
  });
});
