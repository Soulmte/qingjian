import { commandMenuItem, presentCommands } from "@/lib/commands";
import { copyText, type ContextMenuItem } from "@/lib/context-menu";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note } from "@/types";

/**
 * The actions for a note, shared by the file tree and the editor's menu.
 *
 * One builder means right-clicking a file in the sidebar and right-clicking
 * inside the open document offer the same actions, in the same order, with the
 * same chords.
 */
export function buildNoteMenu(note: Note): ContextMenuItem[] {
  return [
    {
      id: "note.open",
      label: "打开",
      run: () => useWorkspace.getState().selectNote(note.id),
    },
    {
      id: "note.rename",
      label: "重命名…",
      chord: "F2",
      run: () => {
        useWorkspace.getState().selectNote(note.id);
        useUi.getState().setRenamingNoteId(note.id);
      },
    },
    {
      id: "note.copyPath",
      label: "复制笔记路径",
      run: () => copyText(note.relPath),
    },
    {
      id: "note.copyTitle",
      label: "复制标题",
      run: () => copyText(note.title),
    },
    ...presentCommands([commandMenuItem("note.delete")]),
  ];
}
