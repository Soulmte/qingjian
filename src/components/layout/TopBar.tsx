import { Fragment, useEffect, useState } from "react";

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
/** How long after the last keystroke the heading is re-read. */
const TITLE_DELAY = 250;

/**
 * The open note's title, taken from the document a beat after typing stops.
 *
 * Finding the title walks the document. `useDeferredValue` used to keep that off
 * the critical path, but the bar still subscribed to `content`, so every
 * character typed reconciled the entire toolbar — every button, on every
 * keystroke — to update one line of text. The document is read from the store on
 * a timer instead, so typing costs the toolbar nothing.
 */
function useDocumentTitle(noteId: number | null): string | null {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    if (noteId === null) {
      setTitle(null);
      return;
    }

    let timer: number | null = null;

    const read = () => {
      const { content } = useWorkspace.getState();
      // The fallback is applied by the caller, which knows the note's own name.
      setTitle(content ? extractTitle(content, "") || null : null);
    };

    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        read();
      }, delay);
    };

    // Opening a note should title the window at once, not a beat later.
    read();

    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (state.content !== previous.content) schedule(TITLE_DELAY);
    });

    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [noteId]);

  return title;
}

export function TopBar() {
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);

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
  const documentTitle = useDocumentTitle(activeNoteId);
  const heading = note ? (documentTitle ?? note.title) : "青简";
  const commands = new Map(TOOLBAR_COMMANDS.map((command) => [command.id, command]));

  const renderButton = (command: AppCommand) => (
    <ToolbarButton
      key={command.id}
      label={command.shortcut ? `${command.title}（${command.shortcut}）` : command.title}
      text={command.short ?? command.title}
      active={TOGGLES[command.id] ? active[TOGGLES[command.id]!] : undefined}
      disabled={command.enabled ? !command.enabled() : false}
      tone={command.danger ? "danger" : "default"}
      onPress={() => void command.run()}
    >
      {command.icon}
    </ToolbarButton>
  );

  return (
    <header className="qj-toolbar qj-topbar flex h-12 shrink-0 items-center gap-0.5 border-b border-border/80 px-2.5">
      {TOOLBAR_LAYOUT.map((entry, index) => {
        if (entry === null) {
          return <span key={`divider-${index}`} className="mx-1.5 h-6 w-px shrink-0 bg-border" />;
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
                  label={
                    command.shortcut
                      ? `${command.title}（${command.shortcut}）`
                      : command.title
                  }
                  text={command.short ?? command.title}
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
