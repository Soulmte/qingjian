import { commandsCtx, type CmdKey } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  createCodeBlockCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  addRowAfterCommand,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  insertTableCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { $useKeymap } from "@milkdown/kit/utils";

import { isInTable } from "@/lib/editor/align-selection";

/**
 * Forwards a keypress to a Milkdown command registered in the command manager.
 *
 * Takes the command *object* rather than its `.key`.
 *
 * Milkdown's `$command` attaches that key inside the command's own async plugin
 * (`plugin.key = cmdKey`), so at module scope `wrapInHeadingCommand.key` is still
 * `undefined`. Capturing it there — which is what this did — made every chord in
 * this file dispatch `commands.call(undefined, …)` and throw instead of acting.
 * Twenty-one bindings were dead, and the thrown error surfaced nowhere the UI
 * could show it, so the shortcuts page kept advertising them.
 *
 * Reading `.key` inside the returned closure is what the presets do, and nothing
 * can be captured too early when the object is what gets passed in.
 */
function dispatch<P = undefined>(command: { key: CmdKey<P> }, payload?: P) {
  return (ctx: Ctx): (() => boolean) => {
    const commands = ctx.get(commandsCtx);
    return () => commands.call(command.key, payload as P);
  };
}

/**
 * Typora-compatible shortcuts.
 *
 * Typora drives paragraph and format changes from `Ctrl+1…6`, `Ctrl+Shift+…`
 * chords, while Milkdown's presets use `Mod-Alt-…`. Both sets are registered,
 * so the editor accepts either habit; these bindings are the ones listed on the
 * shortcuts page.
 *
 * Bindings already provided by the presets (`Mod-b`, `Mod-i`, `Mod-e`, undo and
 * redo) are deliberately not repeated here.
 */
export const typoraKeymap = $useKeymap("typoraKeymap", {
  Heading1: { shortcuts: "Mod-1", command: dispatch(wrapInHeadingCommand, 1) },
  Heading2: { shortcuts: "Mod-2", command: dispatch(wrapInHeadingCommand, 2) },
  Heading3: { shortcuts: "Mod-3", command: dispatch(wrapInHeadingCommand, 3) },
  Heading4: { shortcuts: "Mod-4", command: dispatch(wrapInHeadingCommand, 4) },
  Heading5: { shortcuts: "Mod-5", command: dispatch(wrapInHeadingCommand, 5) },
  Heading6: { shortcuts: "Mod-6", command: dispatch(wrapInHeadingCommand, 6) },
  Paragraph: { shortcuts: "Mod-0", command: dispatch(turnIntoTextCommand) },

  CodeFence: { shortcuts: "Mod-Shift-k", command: dispatch(createCodeBlockCommand) },
  Quote: { shortcuts: "Mod-Shift-q", command: dispatch(wrapInBlockquoteCommand) },
  InlineCode: { shortcuts: "Mod-Shift-`", command: dispatch(toggleInlineCodeCommand) },
  OrderedList: { shortcuts: "Mod-Shift-[", command: dispatch(wrapInOrderedListCommand) },
  BulletList: { shortcuts: "Mod-Shift-]", command: dispatch(wrapInBulletListCommand) },
  Table: { shortcuts: "Mod-t", command: dispatch(insertTableCommand) },
  // Typora toggles a link on Ctrl+K; the href is filled in afterwards through
  // the link tooltip.
  Link: { shortcuts: "Mod-k", command: dispatch(toggleLinkCommand) },

  Strikethrough: { shortcuts: "Alt-Shift-5", command: dispatch(toggleStrikethroughCommand) },

  // Typora's table behaviour: Tab walks the cells and appends a row once the last
  // one is reached; Shift-Tab walks back. Both decline outside a table, so the
  // list keymap keeps Tab to itself for indenting a list item.
  //
  // Composed from `dispatch` — the one place that reads a command's key — and
  // called without a `state`, because `commands.call` already runs against the
  // editor's current one and reports whether the command applied. That report is
  // what makes the append-on-last-cell fallback possible: the row is only added
  // when no cell follows.
  NextTableCell: {
    shortcuts: "Tab",
    command: (ctx) => {
      const nextCell = dispatch(goToNextTableCellCommand)(ctx);
      const addRow = dispatch(addRowAfterCommand)(ctx);
      return (state) => {
        if (!isInTable(state)) return false;
        if (nextCell()) return true;
        addRow();
        return nextCell();
      };
    },
  },
  PrevTableCell: {
    shortcuts: "Shift-Tab",
    command: (ctx) => {
      const prevCell = dispatch(goToPrevTableCellCommand)(ctx);
      return (state) => (isInTable(state) ? prevCell() : false);
    },
  },

  // The alignment chords are deliberately absent. They are owned by the app's
  // `format.align*` commands, which align a block or an image and delegate to
  // the GFM preset when the caret is inside a table. Binding them here as well
  // meant the same chord was claimed twice, and which one applied came down to
  // plugin ordering.
});
