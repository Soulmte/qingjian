import type { Editor } from "@milkdown/kit/core";
import { commandsCtx, type CmdKey } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * The active editor view.
 *
 * Only one editor is mounted at a time, so it is kept here instead of being
 * threaded through React context. Panels such as the find bar need to drive
 * ProseMirror directly; going through props would re-render the whole pane on
 * every transaction.
 */
let activeView: EditorView | null = null;

type Listener = () => void;

/** Fires after every document or selection change. */
const listeners = new Set<Listener>();
/** Fires only when a different editor instance becomes active. */
const viewListeners = new Set<Listener>();

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view;
  // Panels keyed off ProseMirror state have to re-apply it to the new editor.
  for (const listener of viewListeners) listener();
}

export function getActiveEditorView(): EditorView | null {
  if (activeView && !activeView.isDestroyed) return activeView;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Editor command access                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The mounted editor, kept so menus can reach the command manager.
 *
 * Keymaps get a `Ctx` handed to them, but a menu is opened from a DOM event and
 * has no such parameter; the presets' commands live in `commandsCtx`, which only
 * the editor can resolve.
 */
let activeEditor: Editor | null = null;

export function setActiveEditor(editor: Editor | null): void {
  activeEditor = editor;
}

/** Runs a preset command by key. Returns `false` when no editor is mounted. */
export function runEditorCommand<P>(key: CmdKey<P>, payload?: P): boolean {
  const editor = activeEditor;
  if (!editor) return false;
  editor.action((ctx) => ctx.get(commandsCtx).call(key, payload as P));
  return true;
}

/** Lets panels re-read state after the document or selection changed. */
export function notifyEditorChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeEditor(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notifies when the mounted editor instance changes, including remounts. */
export function subscribeEditorView(listener: Listener): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

/* -------------------------------------------------------------------------- */
/* Editor inserters                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Markdown insertion needs the Crepe instance's parser, which only the mounted
 * editor has. It registers the capability here so toolbar buttons and app-level
 * shortcuts can insert content without reaching into the editor component.
 */
let insertMarkdown: ((markdown: string) => void) | null = null;

export function setMarkdownInserter(inserter: ((markdown: string) => void) | null): void {
  insertMarkdown = inserter;
}

/** Parses `markdown` and replaces the selection. Silently does nothing if no editor is mounted. */
export function runInsertMarkdown(markdown: string): boolean {
  if (!insertMarkdown) return false;
  insertMarkdown(markdown);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Paste as plain text                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Set by the `Ctrl+Shift+V` command and consumed by the editor's paste
 * handler.
 *
 * The browser cannot be told to paste only the `text/plain` flavour, so the
 * shortcut is left unprevented — the real paste happens, and the handler swaps
 * the payload for its plain-text half.
 */
let plainPasteArmed = false;

export function armPlainPaste(): void {
  plainPasteArmed = true;
}

/** Reads and clears the flag, so a stray paste cannot inherit it later. */
export function consumePlainPaste(): boolean {
  const armed = plainPasteArmed;
  plainPasteArmed = false;
  return armed;
}
