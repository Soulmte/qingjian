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
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BoxSelect,
  ClipboardCopy,
  Code,
  Copy,
  Eraser,
  FileText,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Scissors,
  SquareCode,
  SquarePlus,
  Strikethrough,
  Table,
  Undo2,
} from "lucide-react";

import { commandMenuItem, presentCommands } from "@/lib/commands";
import {
  copyText,
  runClipboardCommand,
  type ContextMenuEntry,
  type ContextMenuItem,
} from "@/lib/context-menu";
import {
  IMAGE_BLOCK,
  alignmentForUi,
  selectedBlock,
} from "@/lib/editor/align-selection";
import { applyAlignment, clearFormatting, type EditableHost } from "@/lib/editor/actions";
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

/** The icon each alignment shows, in the segmented row inside the 对齐 submenu. */
const ALIGN_ICON = {
  left: <AlignLeft />,
  center: <AlignCenter />,
  right: <AlignRight />,
} as const;

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
  // Inside a table the alignment rows drive the column instead of a block, so
  // what they show as active comes from the cell rather than from `target`.
  const alignment = alignmentForUi(state);
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
    icon: <Undo2 />,
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
    icon: <Redo2 />,
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
    icon: <Scissors />,
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
    icon: <Copy />,
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
    icon: <BoxSelect />,
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
      icon: <Bold />,
      submenu: [
        {
          id: "format.bold",
          label: "加粗",
          icon: <Bold />,
          chord: "Ctrl+B",
          run: () => runEditorCommand(toggleStrongCommand.key),
        },
        {
          id: "format.italic",
          label: "斜体",
          icon: <Italic />,
          chord: "Ctrl+I",
          run: () => runEditorCommand(toggleEmphasisCommand.key),
        },
        {
          id: "format.strike",
          label: "删除线",
          icon: <Strikethrough />,
          chord: "Alt+Shift+5",
          run: () => runEditorCommand(toggleStrikethroughCommand.key),
        },
        {
          id: "format.inlineCode",
          label: "行内代码",
          icon: <Code />,
          chord: "Ctrl+Shift+`",
          run: () => runEditorCommand(toggleInlineCodeCommand.key),
        },
        {
          id: "format.clear",
          label: "清除格式",
          icon: <Eraser />,
          chord: "Ctrl+\\",
          run: () => clearFormatting(view),
        },
      ],
    },

    {
      id: "menu.paragraph",
      label: "段落",
      icon: <Pilcrow />,
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
          icon: <Quote />,
          chord: "Ctrl+Shift+Q",
          run: () => runEditorCommand(wrapInBlockquoteCommand.key),
        },
        {
          id: "para.bullet",
          label: "无序列表",
          icon: <List />,
          chord: "Ctrl+Shift+]",
          run: () => runEditorCommand(wrapInBulletListCommand.key),
        },
        {
          id: "para.ordered",
          label: "有序列表",
          icon: <ListOrdered />,
          chord: "Ctrl+Shift+[",
          run: () => runEditorCommand(wrapInOrderedListCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.taskList")]),
      ],
    },

    {
      id: "menu.align",
      label: "对齐",
      icon: <AlignLeft />,
      submenu: [
        {
          row: (["left", "center", "right"] as const).map((align) => ({
            id: `align.${align}`,
            label: align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐",
            icon: ALIGN_ICON[align],
            chord:
              align === "center" ? "Ctrl+Shift+E" : align === "right" ? "Ctrl+Shift+R" : undefined,
            selected: alignment === align,
            disabled: alignment === null,
            run: () => {
              applyAlignment(view, align);
              view.focus();
            },
          })),
        },
      ],
    },

    {
      id: "menu.insert",
      label: "插入",
      icon: <SquarePlus />,
      submenu: [
        {
          id: "insert.link",
          label: "链接",
          icon: <Link />,
          chord: "Ctrl+K",
          run: () => runEditorCommand(toggleLinkCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.insertImage")]),
        {
          id: "insert.table",
          label: "表格",
          icon: <Table />,
          chord: "Ctrl+T",
          run: () => runEditorCommand(insertTableCommand.key),
        },
        {
          id: "insert.code",
          label: "代码块",
          icon: <SquareCode />,
          chord: "Ctrl+Shift+K",
          run: () => runEditorCommand(createCodeBlockCommand.key),
        },
        ...presentCommands([commandMenuItem("edit.insertMath")]),
        {
          id: "insert.hr",
          label: "分割线",
          icon: <Minus />,
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
      icon: <Image />,
      submenu: [
        {
          id: "image.copySrc",
          label: "复制图片地址",
          icon: <Link />,
          run: () => copyText(reference),
        },
        {
          id: "image.copyMarkdown",
          label: "复制 Markdown 引用",
          icon: <ClipboardCopy />,
          run: () => copyText(`![](${reference})`),
        },
      ],
    });
  }

  const note = useWorkspace
    .getState()
    .notes.find((item) => item.id === useWorkspace.getState().activeNoteId);

  if (note) {
    entries.push({
      id: "menu.note",
      label: "笔记",
      icon: <FileText />,
      submenu: buildNoteMenu(note),
    });
  }

  return entries;
}
