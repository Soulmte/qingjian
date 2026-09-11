import { selectAll } from "@milkdown/kit/prose/commands";
import { redo, undo } from "@milkdown/kit/prose/history";
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";

import { commandMenuItem, presentCommands } from "@/lib/commands";
import {
  copyText,
  runClipboardCommand,
  type ContextMenuEntry,
  type ContextMenuItem,
} from "@/lib/context-menu";
import { clearFormatting, type EditableHost } from "@/lib/editor/actions";
import { IMAGE_BLOCK, applyAlign, selectedBlock } from "@/lib/editor/align-selection";
import { runEditorCommand } from "@/lib/editor/bridge";
import { stripAlignment } from "@/lib/editor/image-align";
import { buildNoteMenu } from "@/lib/note-menu";
import { useWorkspace } from "@/stores/workspace";

/**
 * The slice of `EditorView` this module drives.
 *
 * Narrower than the real view so the menu can be built against a plain editor
 * state in a test; `EditorView` satisfies it structurally.
 */
export interface EditorMenuHost extends EditableHost {
  focus: () => void;
}

/**
 * The editor's right-click menu.
 *
 * Everyday actions are one click away at the top level; the long lists (format,
 * paragraph, alignment, insert) sit behind submenus so the menu opens at a
 * readable height instead of thirty rows. Alignment is only offered when there
 * is a block it can actually move.
 */
export function buildEditorMenu(view: EditorMenuHost): ContextMenuEntry[] {
  const { state } = view;
  const target = selectedBlock(state);
  const imageSrc =
    target && target.node.type.name === IMAGE_BLOCK ? String(target.node.attrs.src) : null;

  // The level in force, so the segmented control can mark it. `null` means the
  // selection is not a text block at all (an image, or a list), where changing
  // the level is meaningless and the segments are disabled.
  const level =
    target === null
      ? null
      : target.node.type.name === "heading"
        ? Number(target.node.attrs.level)
        : target.node.type.name === "paragraph"
          ? 0
          : null;

  const undoItem: ContextMenuItem = {
    id: "edit.undo",
    label: "撤销",
    chord: "Ctrl+Z",
    disabled: !undo(state),
    run: () => {
      undo(view.state, view.dispatch);
      view.focus();
    },
  };

  const redoItem: ContextMenuItem = {
    id: "edit.redo",
    label: "重做",
    chord: "Ctrl+Y",
    disabled: !redo(state),
    run: () => {
      redo(view.state, view.dispatch);
      view.focus();
    },
  };

  const cutItem: ContextMenuItem = {
    id: "edit.cut",
    label: "剪切",
    chord: "Ctrl+X",
    disabled: state.selection.empty,
    run: () => {
      view.focus();
      runClipboardCommand("cut");
    },
  };

  const copyItem: ContextMenuItem = {
    id: "edit.copy",
    label: "复制",
    chord: "Ctrl+C",
    disabled: state.selection.empty,
    run: () => {
      view.focus();
      runClipboardCommand("copy");
    },
  };

  const selectAllItem: ContextMenuItem = {
    id: "edit.selectAll",
    label: "全选",
    chord: "Ctrl+A",
    run: () => {
      selectAll(view.state, view.dispatch);
      view.focus();
    },
  };

  const entries: ContextMenuEntry[] = [
    undoItem,
    redoItem,
    cutItem,
    copyItem,
    selectAllItem,

    {
      id: "menu.format",
      label: "格式",
      submenu: [
        {
          id: "format.bold",
          label: "加粗",
          chord: "Ctrl+B",
          run: () => runEditorCommand(toggleStrongCommand.key),
        },
        {
          id: "format.italic",
          label: "斜体",
          chord: "Ctrl+I",
          run: () => runEditorCommand(toggleEmphasisCommand.key),
        },
        {
          id: "format.strike",
          label: "删除线",
          chord: "Alt+Shift+5",
          run: () => runEditorCommand(toggleStrikethroughCommand.key),
        },
        {
          id: "format.inlineCode",
          label: "行内代码",
          chord: "Ctrl+Shift+`",
          run: () => runEditorCommand(toggleInlineCodeCommand.key),
        },
        {
          id: "format.clear",
          label: "清除格式",
          chord: "Ctrl+\\",
          run: () => clearFormatting(view),
        },
      ],
    },

    {
      id: "menu.paragraph",
      label: "段落",
      submenu: [
        {
          row: [
            {
              id: "para.text",
              label: "正文",
              chord: "Ctrl+0",
              selected: level === 0,
              disabled: level === null,
              run: () => runEditorCommand(turnIntoTextCommand.key),
            },
            ...[1, 2, 3, 4, 5, 6].map((heading) => ({
              id: `para.h${heading}`,
              label: `H${heading}`,
              description: `标题 ${heading}`,
              chord: `Ctrl+${heading}`,
              selected: level === heading,
              disabled: level === null,
              run: () => runEditorCommand(wrapInHeadingCommand.key, heading),
            })),
          ],
        },
        {
          id: "para.quote",
          label: "引用",
          chord: "Ctrl+Shift+Q",
          run: () => runEditorCommand(wrapInBlockquoteCommand.key),
        },
        {
          id: "para.bullet",
          label: "无序列表",
          chord: "Ctrl+Shift+]",
          run: () => runEditorCommand(wrapInBulletListCommand.key),
        },
        {
          id: "para.ordered",
          label: "有序列表",
          chord: "Ctrl+Shift+[",
          run: () => runEditorCommand(wrapInOrderedListCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.taskList")]),
      ],
    },

    {
      id: "menu.align",
      label: "对齐",
      submenu: [
        {
          row: (["left", "center", "right"] as const).map((align) => ({
            id: `align.${align}`,
            label: align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐",
            chord:
              align === "center" ? "Ctrl+Shift+E" : align === "right" ? "Ctrl+Shift+R" : undefined,
            selected: target?.align === align,
            disabled: target === null,
            run: () => {
              const transaction = applyAlign(view.state, align);
              if (transaction) view.dispatch(transaction);
              view.focus();
            },
          })),
        },
      ],
    },

    {
      id: "menu.insert",
      label: "插入",
      submenu: [
        {
          id: "insert.link",
          label: "链接",
          chord: "Ctrl+K",
          run: () => runEditorCommand(toggleLinkCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.insertImage")]),
        {
          id: "insert.table",
          label: "表格",
          chord: "Ctrl+T",
          run: () => runEditorCommand(insertTableCommand.key),
        },
        {
          id: "insert.code",
          label: "代码块",
          chord: "Ctrl+Shift+K",
          run: () => runEditorCommand(createCodeBlockCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.insertMath")]),
        {
          id: "insert.hr",
          label: "分割线",
          run: () => runEditorCommand(insertHrCommand.key),
        },
      ],
    },
  ];

  if (imageSrc !== null) {
    const reference = stripAlignment(imageSrc);
    entries.push({
      id: "menu.image",
      label: "图片",
      submenu: [
        {
          id: "image.copySrc",
          label: "复制图片地址",
          run: () => copyText(reference),
        },
        {
          id: "image.copyMarkdown",
          label: "复制 Markdown 引用",
          run: () => copyText(`![](${reference})`),
        },
      ],
    });
  }

  const note = useWorkspace
    .getState()
    .notes.find((item) => item.id === useWorkspace.getState().activeNoteId);

  if (note) {
    entries.push({ id: "menu.note", label: "笔记", submenu: buildNoteMenu(note) });
  }

  return entries;
}
