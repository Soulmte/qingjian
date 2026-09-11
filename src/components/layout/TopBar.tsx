import { Fragment } from "react";

import {
  ALIGN_COMMANDS,
  TOOLBAR_COMMANDS,
  TOOLBAR_LAYOUT,
  type AppCommand,
} from "@/lib/commands";
import { extractTitle } from "@/lib/markdown";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

import { ToolbarButton } from "../ui/ToolbarButton";

/**
 * Toggle commands whose button reflects current state.
 */
const TOGGLES: Record<string, string> = {
  "sidebar.toggle": "sidebar",
  "source.toggle": "source",
  "focus.toggle": "focus",
  "typewriter.toggle": "typewriter",
  "outline.toggle": "outline",
  "palette.open": "palette",
  "settings.open": "settings",
  "find.open": "find",
};

/**
 * The window's action strip.
 *
 * The title sits in the middle so the file actions stay on the left and the
 * view toggles on the right, which keeps the two groups in the same place no
 * matter how long a note's heading is.
 */
export function TopBar() {
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const content = useWorkspace((state) => state.content);

  const showOutline = useSettings((state) => state.settings.showOutline);
  const focusMode = useSettings((state) => state.settings.focusMode);
  const typewriterMode = useSettings((state) => state.settings.typewriterMode);

  const isSidebarOpen = useUi((state) => state.isSidebarOpen);
  const isSourceMode = useUi((state) => state.isSourceMode);
  const isPaletteOpen = useUi((state) => state.isPaletteOpen);
  const isSettingsOpen = useUi((state) => state.isSettingsOpen);
  const isFindOpen = useUi((state) => state.isFindOpen);
  const blockAlign = useUi((state) => state.blockAlign);

  const active: Record<string, boolean> = {
    sidebar: isSidebarOpen ?? false,
    source: isSourceMode,
    focus: focusMode,
    typewriter: typewriterMode,
    outline: showOutline,
    palette: isPaletteOpen,
    settings: isSettingsOpen,
    find: isFindOpen,
  };

  const note = notes.find((item) => item.id === activeNoteId) ?? null;
  const heading = note ? extractTitle(content, note.title) : "青简";
  const commands = new Map(TOOLBAR_COMMANDS.map((command) => [command.id, command]));

  const renderButton = (command: AppCommand) => (
    <ToolbarButton
      key={command.id}
      label={command.shortcut ? `${command.title}（${command.shortcut}）` : command.title}
      active={TOGGLES[command.id] ? active[TOGGLES[command.id]!] : undefined}
      disabled={command.enabled ? !command.enabled() : false}
      tone={command.danger ? "danger" : "default"}
      onPress={() => void command.run()}
    >
      {command.icon}
    </ToolbarButton>
  );

  return (
    <header className="qj-toolbar flex h-11 shrink-0 items-center gap-0.5 border-b border-border/60 px-2.5">
      {TOOLBAR_LAYOUT.map((entry, index) => {
        if (entry === null) {
          return <span key={`divider-${index}`} className="mx-1.5 h-5 w-px shrink-0 bg-border" />;
        }

        if (entry === "TITLE") {
          return (
            <span
              key="title"
              className="min-w-0 flex-1 truncate px-2 text-center text-sm font-medium"
            >
              {note ? heading : "青简"}
            </span>
          );
        }

        if (entry === "ALIGN") {
          return (
            <Fragment key="align">
              {ALIGN_COMMANDS.map(({ align, command }) => (
                <ToolbarButton
                  key={command.id}
                  label={command.title}
                  active={blockAlign === align}
                  disabled={blockAlign === null}
                  onPress={() => void command.run()}
                >
                  {command.icon}
                </ToolbarButton>
              ))}
            </Fragment>
          );
        }

        const command = commands.get(entry);
        return command ? renderButton(command) : null;
      })}
    </header>
  );
}
