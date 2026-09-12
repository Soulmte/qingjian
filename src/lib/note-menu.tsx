import {
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Heading,
  Link,
  PencilLine,
  Trash2,
} from "lucide-react";

import { commandMenuItem, presentCommands } from "@/lib/commands";
import { copyText, type ContextMenuItem } from "@/lib/context-menu";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note } from "@/types";

/**
 * The two create actions.
 *
 * Exported for the sidebar's + button, which offers the same pair as a dropdown
 * instead of committing to a note. The tree's row menu and the background menu
 * build from this too, so the three can never disagree about what creating
 * something inside `folder` means.
 */
export function buildCreateMenu(folder = ""): ContextMenuItem[] {
  return [
    {
      id: "folder.newNote",
      label: "新建笔记",
      icon: <FilePlus2 />,
      run: () => useUi.getState().openNewNote(folder),
    },
    {
      id: "folder.newFolder",
      label: "新建文件夹",
      icon: <FolderPlus />,
      run: () => useUi.getState().openNewFolder(folder),
    },
  ];
}

/**
 * The two rows that re-read the tree.
 *
 * Built from the registry so their labels, icons and enabled state come from the
 * one declaration in `APP_COMMANDS`, and so they stay searchable in the palette.
 *
 * Exported for the sidebar's own button: these two are the ones that have to stay
 * reachable when a long list of files fills the sidebar, because the blank area
 * below the rows — the other place they live — is then gone.
 */
export function buildReloadMenu(): ContextMenuItem[] {
  return presentCommands([
    commandMenuItem("workspace.refresh"),
    commandMenuItem("workspace.reload"),
  ]);
}

/**
 * The actions for a note, shared by the file tree and the editor's menu.
 *
 * One builder means right-clicking a file in the sidebar and right-clicking
 * inside the open document offer the same actions, in the same order, with the
 * same chords.
 *
 * `inTree` adds the workspace-wide rows. The editor's 笔记 submenu leaves them
 * out: they act on the folder tree, which is not on screen there.
 */
export function buildNoteMenu(note: Note, inTree = false): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      id: "note.open",
      label: "打开",
      icon: <FileText />,
      run: () => useWorkspace.getState().selectNote(note.id),
    },
    {
      id: "note.rename",
      label: "重命名…",
      icon: <PencilLine />,
      chord: "F2",
      run: () => {
        useWorkspace.getState().selectNote(note.id);
        useUi.getState().setRenamingNoteId(note.id);
      },
    },
    {
      id: "note.copyPath",
      label: "复制笔记路径",
      icon: <Link />,
      run: () => copyText(note.relPath),
    },
    {
      id: "note.copyTitle",
      label: "复制标题",
      icon: <Heading />,
      run: () => copyText(note.title),
    },
    {
      id: "note.reveal",
      label: "在资源管理器打开",
      icon: <FolderOpen />,
      run: () => void useWorkspace.getState().revealPath(note.relPath),
    },
  ];

  // Before the destructive row, which is last in both menus.
  if (inTree) items.push(...buildReloadMenu());

  items.push(...presentCommands([commandMenuItem("note.delete")]));
  return items;
}

/**
 * The actions for a folder row, and for the empty area below the tree.
 *
 * `folder` is the relative path the actions apply to; `""` is the workspace
 * root, which is what the tree's background menu passes. The root has no path of
 * its own to copy, so that row is left out there.
 */
export function buildFolderMenu(folder: string): ContextMenuItem[] {
  const items: ContextMenuItem[] = buildCreateMenu(folder);

  // The root has no name to change and no path of its own to copy or delete.
  if (folder) {
    items.push({
      id: "folder.rename",
      label: "重命名…",
      icon: <PencilLine />,
      run: () => useUi.getState().setRenamingFolder(folder),
    });
  }

  items.push(
    {
      id: "folder.reveal",
      label: folder ? "在资源管理器打开" : "在资源管理器中打开工作区",
      icon: <FolderOpen />,
      run: () => void useWorkspace.getState().revealPath(folder),
    },
    // Both act on the whole workspace rather than on the row that was clicked, so
    // they sit here rather than under the folder's own name.
    ...buildReloadMenu(),
  );

  if (folder) {
    items.push(
      {
        id: "folder.copyPath",
        label: "复制文件夹路径",
        icon: <Link />,
        run: () => copyText(folder),
      },
      {
        id: "folder.delete",
        label: "删除文件夹",
        icon: <Trash2 />,
        danger: true,
        run: () => useUi.getState().setPendingDeleteFolder(folder),
      },
    );
  }

  return items;
}
