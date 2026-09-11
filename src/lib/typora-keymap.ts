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
import { insertTableCommand, setAlignCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { Command } from "@milkdown/kit/prose/state";
import { $useKeymap } from "@milkdown/kit/utils";

/**
 * Forwards a keypress to a Milkdown command registered in the command manager.
 * Mirrors the pattern used by Milkdown's own presets.
 */
function dispatch<P = undefined>(key: CmdKey<P>, payload?: P) {
  return (ctx: Ctx): Command => {
    const commands = ctx.get(commandsCtx);
    return () => commands.call(key, payload as P);
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
  Heading1: { shortcuts: "Mod-1", command: dispatch(wrapInHeadingCommand.key, 1) },
  Heading2: { shortcuts: "Mod-2", command: dispatch(wrapInHeadingCommand.key, 2) },
  Heading3: { shortcuts: "Mod-3", command: dispatch(wrapInHeadingCommand.key, 3) },
  Heading4: { shortcuts: "Mod-4", command: dispatch(wrapInHeadingCommand.key, 4) },
  Heading5: { shortcuts: "Mod-5", command: dispatch(wrapInHeadingCommand.key, 5) },
  Heading6: { shortcuts: "Mod-6", command: dispatch(wrapInHeadingCommand.key, 6) },
  Paragraph: { shortcuts: "Mod-0", command: dispatch(turnIntoTextCommand.key) },

  CodeFence: { shortcuts: "Mod-Shift-k", command: dispatch(createCodeBlockCommand.key) },
  Quote: { shortcuts: "Mod-Shift-q", command: dispatch(wrapInBlockquoteCommand.key) },
  InlineCode: { shortcuts: "Mod-Shift-`", command: dispatch(toggleInlineCodeCommand.key) },
  OrderedList: { shortcuts: "Mod-Shift-[", command: dispatch(wrapInOrderedListCommand.key) },
  BulletList: { shortcuts: "Mod-Shift-]", command: dispatch(wrapInBulletListCommand.key) },
  Table: { shortcuts: "Mod-t", command: dispatch(insertTableCommand.key) },
  // Typora toggles a link on Ctrl+K; the href is filled in afterwards through
  // the link tooltip.
  Link: { shortcuts: "Mod-k", command: dispatch(toggleLinkCommand.key) },

  Strikethrough: { shortcuts: "Alt-Shift-5", command: dispatch(toggleStrikethroughCommand.key) },
  // Typora's alignment applies to tables and images; the table column is what
  // the GFM schema can express here.
  AlignCenter: { shortcuts: "Mod-Shift-e", command: dispatch(setAlignCommand.key, "center") },
  AlignRight: { shortcuts: "Mod-Shift-r", command: dispatch(setAlignCommand.key, "right") },
});
