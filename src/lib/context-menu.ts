import type { ReactNode } from "react";
import { create } from "zustand";

/** One actionable row. */
export interface ContextMenuItem {
  id: string;
  label: string;
  /** Tooltip text; defaults to `label`. Rows use a short label plus this. */
  description?: string;
  icon?: ReactNode;
  /** Displayed on the right; every one of these is a chord the app really binds. */
  chord?: string;
  disabled?: boolean;
  danger?: boolean;
  /**
   * This row is the current value of a group (the heading level in force, the
   * alignment the block already has). Rows are drawn as a segmented control, so
   * the selected one has to be marked or the panel says nothing about state.
   */
  selected?: boolean;
  /** Opens a second level to the side instead of acting immediately. */
  submenu?: ContextMenuEntry[];
  /** Absent on a row that only opens a submenu. */
  run?: () => void;
}

/**
 * A menu is a list of sections.
 *
 * `heading` labels a group, and `row` lays a few short items out side by side —
 * which is how the six heading levels and the three alignments stay one line
 * tall instead of nine, without hiding them behind a submenu.
 */
export type ContextMenuEntry =
  | ContextMenuItem
  | { heading: string }
  | { row: ContextMenuItem[] };

interface OpenMenu {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
  /**
   * The element the menu was opened from, when it was opened by a left click
   * rather than by right-clicking a surface.
   *
   * Two things depend on it: clicking that element does not dismiss the menu
   * (otherwise a dropdown could not be toggled shut by its own trigger), and the
   * trigger can compare it to itself to know whether the open menu is its own.
   */
  anchor?: Element | null;
}

interface ContextMenuState {
  menu: OpenMenu | null;
  openAt: (x: number, y: number, entries: ContextMenuEntry[], anchor?: Element | null) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  openAt: (x, y, entries, anchor = null) => set({ menu: { x, y, entries, anchor } }),
  close: () => set((state) => (state.menu === null ? state : { menu: null })),
}));

export function isMenuItem(entry: ContextMenuEntry): entry is ContextMenuItem {
  return "id" in entry;
}

/** Every actionable item at one level, in reading order. */
export function menuItems(entries: ContextMenuEntry[]): ContextMenuItem[] {
  return entries.flatMap((entry) => {
    if (isMenuItem(entry)) return [entry];
    if ("row" in entry) return entry.row;
    return [];
  });
}

/** Whether a row can be activated at all (as opposed to only opening a submenu). */
export function canActivate(item: ContextMenuItem): boolean {
  return item.run !== undefined;
}

/**
 * Copies text using the clipboard access the page already has.
 *
 * `navigator.clipboard` is not available in the webview — the permission prompt
 * it needs has nowhere to appear — so this selects a detached textarea and runs
 * the legacy copy command, which is what makes "复制图片地址" work at all.
 */
export function copyText(value: string): boolean {
  if (!value) return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

/**
 * Runs a clipboard command against the focused editable.
 *
 * `document.execCommand` is the only way to reach cut and copy from script in
 * this webview; paste is deliberately absent because Chromium refuses it for
 * anything but a user-initiated event, and an item that silently does nothing
 * would be worse than not offering it.
 */
export function runClipboardCommand(command: "cut" | "copy"): boolean {
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}
