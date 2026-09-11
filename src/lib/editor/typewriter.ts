import type { EditorView } from "@milkdown/kit/prose/view";

/** Fraction of the viewport the caret may drift within before we follow it. */
const DEAD_ZONE = 0.12;

/**
 * Keeps the caret vertically centred — the behaviour Typora calls typewriter
 * mode.
 *
 * A dead zone keeps this from starting a smooth-scroll animation on every
 * keystroke; constant motion reads as jitter rather than flow.
 */
export function centerCaret(view: EditorView, scroller: HTMLElement, immediate = false): void {
  let caretTop: number;
  try {
    caretTop = view.coordsAtPos(view.state.selection.from).top;
  } catch {
    // The position can be transiently unrenderable, e.g. mid-rebuild.
    return;
  }

  const scrollerTop = scroller.getBoundingClientRect().top;
  const caretOffset = caretTop - scrollerTop + scroller.scrollTop;
  const target = Math.max(0, caretOffset - scroller.clientHeight / 2);

  if (immediate) {
    scroller.scrollTop = target;
    return;
  }

  if (Math.abs(target - scroller.scrollTop) < scroller.clientHeight * DEAD_ZONE) return;
  scroller.scrollTo({ top: target, behavior: "smooth" });
}
