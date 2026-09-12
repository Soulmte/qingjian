import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { parseOutline, type OutlineItem } from "@/lib/markdown";
import { useWorkspace } from "@/stores/workspace";

const HEADING_SELECTOR = ".milkdown .ProseMirror :is(h1,h2,h3,h4,h5,h6)";
/** Distance from the top of the viewport that counts as "the current heading". */
const ACTIVE_OFFSET = 96;

/** The rendered headings, in document order — the same order `parseOutline` uses. */
function renderedHeadings(): HTMLElement[] {
  const scroller = document.querySelector(".editor-scroll");
  if (!scroller) return [];
  return Array.from(scroller.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
}

/** How long after the last keystroke the outline is rebuilt. */
const OUTLINE_DELAY = 250;

/**
 * The headings of the open note, rebuilt a beat after typing stops.
 *
 * Parsing walks the whole document. `useDeferredValue` used to keep that off the
 * critical path, but the panel still subscribed to `content`, so every character
 * typed re-rendered it — and on a long note the deferred pass then ran often
 * enough to be felt anyway. Reading the text from the store on a timer instead
 * means a keystroke costs the outline nothing at all.
 */
function useOutlineItems(loaded: boolean, noteId: number | null) {
  const [items, setItems] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!loaded) {
      setItems([]);
      return;
    }

    let timer: number | null = null;

    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setItems(parseOutline(useWorkspace.getState().content));
      }, delay);
    };

    // Opening a note should show its outline at once, not a beat later.
    schedule(0);

    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (state.content !== previous.content) schedule(OUTLINE_DELAY);
    });

    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loaded, noteId]);

  return items;
}

export function Outline() {
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);

  const items = useOutlineItems(contentLoaded, activeNoteId);

  const [activeIndex, setActiveIndex] = useState(-1);

  // Mirror where the reader is: the last heading scrolled above the marker.
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(-1);
      return;
    }

    const update = () => {
      const headings = renderedHeadings();
      let current = -1;
      const threshold = (document.querySelector(".editor-scroll")?.getBoundingClientRect().top ?? 0) + ACTIVE_OFFSET;

      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= threshold) current = index;
      });

      setActiveIndex(current);
    };

    update();

    // Listening in the capture phase catches scrolling from any descendant,
    // which keeps working when the editor element is replaced.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [items.length, activeNoteId, contentLoaded]);

  const jumpTo = (index: number) => {
    // Index-based lookup: matching on text breaks when two headings repeat.
    renderedHeadings()[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted">当前文档没有标题</p>;
  }

  return (
    <ul className="px-1.5 py-1">
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <li key={`${item.line}-${item.text}`}>
            <button
              type="button"
              className={cn(
                "relative w-full truncate rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
                isActive ? "font-medium" : "text-foreground/75 hover:bg-default/60",
              )}
              style={{
                paddingLeft: (item.level - 1) * 12 + 8,
                ...(isActive
                  ? { background: "var(--qj-accent-light)", color: "var(--qj-accent-strong)" }
                  : null),
              }}
              onClick={() => jumpTo(index)}
              title={item.text}
              aria-current={isActive ? "true" : undefined}
            >
              {item.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
