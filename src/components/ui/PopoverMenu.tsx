import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

const GAP = 6;
/** Minimum room the menu needs below the anchor before it flips above. */
const MIN_HEIGHT = 140;

interface Placement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

/**
 * An anchored menu that escapes its ancestors' `overflow`.
 *
 * Rendered into `document.body` with `position: fixed` — inside the settings
 * dialog an ancestor scrolls with `overflow: auto`, which would otherwise clip
 * the list to the dialog's height.
 *
 * Three details are load-bearing and easy to lose:
 *
 * 1. `data-react-aria-top-layer` — without it, React Aria's `ariaHideOutside`
 *    sets `inert` on everything outside the modal, and `inert` silently kills
 *    clicks, wheel scrolling and focus. The menu would render but be unusable.
 * 2. `--z-index-overlay` — HeroUI's modal overlay sits at 100000; the menu has
 *    to clear that or it renders behind the dialog.
 * 3. The scroll listener runs in the capture phase, so it also sees scrolls
 *    from inside the menu; those have to be ignored or the list cannot scroll.
 */
export function PopoverMenu({
  anchorRef,
  isOpen,
  onClose,
  children,
  minWidth = 220,
  className,
  ariaLabel,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  minWidth?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPlacement(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;

    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const openUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;

      setPlacement({
        left: Math.min(rect.left, Math.max(8, window.innerWidth - minWidth - 8)),
        width: Math.max(minWidth, rect.width),
        maxHeight: Math.max(MIN_HEIGHT, Math.min(320, available - 8)),
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
      });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen, anchorRef, minWidth]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onViewportChange = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || !placement) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn("qj-popover", className)}
      data-react-aria-top-layer=""
      style={{
        left: placement.left,
        width: placement.width,
        top: placement.top,
        bottom: placement.bottom,
      }}
    >
      <div
        role="listbox"
        aria-label={ariaLabel}
        className="overflow-y-auto overscroll-contain p-1"
        style={{ maxHeight: placement.maxHeight }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** One selectable row: a label plus an optional dimmed second line. */
export function PopoverOption({
  selected,
  onSelect,
  children,
  secondary,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col rounded-md px-2.5 py-1.5 text-left transition-colors",
        selected
          ? "bg-accent-soft text-accent-soft-foreground"
          : "hover:bg-default/60",
      )}
    >
      <span className="truncate text-sm">{children}</span>
      {secondary && <span className="truncate text-[11px] text-muted">{secondary}</span>}
    </button>
  );
}
