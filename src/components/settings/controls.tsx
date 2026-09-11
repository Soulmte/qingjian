import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import type { SystemFont } from "@/types";

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  children,
  stacked = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  /** Use for controls that need the full width, such as option grids. */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/50 px-3.5 py-2.5 last:border-b-0",
        stacked ? "flex flex-col gap-2.5" : "flex flex-wrap items-center justify-between gap-3",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className={cn(stacked ? "w-full" : "shrink-0")}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  swatch?: ReactNode;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-border/70 bg-default/40 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground",
            )}
          >
            {option.swatch}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        checked ? "border-transparent" : "border-border bg-default",
      )}
      style={checked ? { background: "var(--qj-accent)" } : undefined}
    >
      <span
        className="absolute top-0.75 size-3.5 rounded-full transition-all"
        style={{
          left: checked ? 18 : 4,
          background: checked ? "var(--qj-accent-text)" : "var(--surface)",
        }}
      />
    </button>
  );
}

export function RangeField({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  ariaLabel: string;
}) {
  return (
    <div className="flex w-52 items-center gap-3">
      <input
        type="range"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-default"
        style={{ accentColor: "var(--qj-accent)" }}
      />
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      className={cn("field w-52", className)}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Font picker                                                                 */
/* -------------------------------------------------------------------------- */

const MENU_WIDTH = 264;
const MENU_PREFERRED_HEIGHT = 320;
/** Floor for the list, so a cramped viewport still shows a few rows. */
const MENU_MIN_LIST_HEIGHT = 96;
/** Height of the search row above the list. */
const SEARCH_ROW_HEIGHT = 45;
/** Gap between the trigger and the menu, and between the menu and the edge. */
const MENU_GAP = 8;

interface MenuPlacement {
  left: number;
  width: number;
  listMaxHeight: number;
  top?: number;
  bottom?: number;
}

/**
 * Font picker over the families installed on this machine.
 *
 * A plain `<select>` would swallow the preview, so this is a small combobox:
 * the trigger and every row render the family it names, which is the only way
 * to tell "Noto Sans" from "Noto Sans SC" at a glance.
 *
 * The menu is portalled to `document.body` and positioned with `position:
 * fixed`. Living inside the settings dialog meant an ancestor with
 * `overflow: auto` clipped the list to the dialog's height.
 */
export function FontPicker({
  value,
  onChange,
  fonts,
  defaultLabel,
  monospaceOnly = false,
  ariaLabel,
}: {
  /** Empty string means "use the built-in stack". */
  value: string;
  onChange: (family: string) => void;
  fonts: SystemFont[];
  defaultLabel: string;
  monospaceOnly?: boolean;
  ariaLabel: string;
}) {
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [query, setQuery] = useState("");

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isOpen = placement !== null;

  const closeMenu = () => setPlacement(null);

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;

    // Open on whichever side has more room whenever the space below cannot fit
    // a full menu. Only flipping when the space below was barely usable left
    // the menu opening into 225px when 545px were free above, which cut the
    // list down to about five rows and made the scroll bar the only way in.
    const openUp = spaceAbove > spaceBelow && spaceBelow < MENU_PREFERRED_HEIGHT;
    const available = openUp ? spaceAbove : spaceBelow;

    // Keep the whole popup inside the viewport: search row + list + borders.
    const listMaxHeight = Math.max(
      MENU_MIN_LIST_HEIGHT,
      Math.min(MENU_PREFERRED_HEIGHT, available - SEARCH_ROW_HEIGHT - 2),
    );

    setQuery("");
    setPlacement({
      left: Math.max(8, rect.right - MENU_WIDTH),
      width: MENU_WIDTH,
      listMaxHeight,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu();
      }
    };
    // Closing on scroll is simpler than tracking every scrollable ancestor.
    //
    // The listener is registered in the capture phase, so it also fires for
    // scrolls dispatched to descendants — and the font list is one of those.
    // Without the guard below, scrolling the list closed the menu instead of
    // scrolling it. `scroll` does not bubble, but capture still visits every
    // ancestor on the way down, which is exactly why this bites.
    const onViewportChange = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      closeMenu();
    };

    // Only the list scrolls, so a wheel over the search row (or the popup's
    // padding) would chain to the dialog behind the menu — which the guard
    // above reads as an outside scroll and closes the menu. Forwarding the
    // delta to the list keeps every wheel inside the menu scrolling the list.
    //
    // React's `onWheel` is registered passively at the root, where
    // `preventDefault()` is a no-op, so this has to be a native listener.
    const popover = menuRef.current;
    const list = popover?.querySelector("ul");
    const onWheel = (event: WheelEvent) => {
      if (!(list instanceof HTMLElement)) return;
      const target = event.target;
      if (target instanceof Node && list.contains(target)) return;
      // `deltaMode` 1 means lines rather than pixels.
      list.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      event.preventDefault();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    popover?.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      popover?.removeEventListener("wheel", onWheel);
    };
  }, [isOpen]);

  const options = useMemo(() => {
    const source = monospaceOnly ? fonts.filter((font) => font.monospace) : fonts;
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((font) => font.family.toLowerCase().includes(needle));
  }, [fonts, monospaceOnly, query]);

  const select = (family: string) => {
    onChange(family);
    closeMenu();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="field flex w-52 items-center justify-between gap-2 text-left"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
      >
        <span
          className="truncate"
          style={value ? { fontFamily: `"${value}", var(--qj-font)` } : undefined}
        >
          {value || defaultLabel}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>

      {placement &&
        createPortal(
          <div
            ref={menuRef}
            className="qj-popover"
            // The menu is portalled to `document.body`, which puts it outside
            // the modal's overlay subtree. React Aria's `ariaHideOutside` sets
            // `inert` on everything outside the overlay — including this node —
            // and `inert` silently kills clicks, wheel scrolling and focus at
            // once. This attribute is the opt-out read by `isAlwaysVisibleNode`
            // and by the focus scope, and it is what react-aria's own overlays
            // set. Without it the menu renders but cannot be used at all.
            data-react-aria-top-layer=""
            style={{
              left: placement.left,
              width: placement.width,
              top: placement.top,
              bottom: placement.bottom,
            }}
          >
            <div className="border-b border-border/60 p-1.5">
              <input
                autoFocus
                className="field w-full"
                placeholder="搜索字体…"
                aria-label="搜索字体"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <ul
              role="listbox"
              aria-label={ariaLabel}
              // `overscroll-contain` stops the wheel from chaining to the
              // dialog once the list hits its end; that chained scroll would
              // otherwise be seen by the guard above as an outside scroll.
              className="overflow-y-auto overscroll-contain p-1"
              style={{ maxHeight: placement.listMaxHeight }}
            >
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ""}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    value === ""
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "hover:bg-default/60",
                  )}
                  onClick={() => select("")}
                >
                  {defaultLabel}
                </button>
              </li>

              {options.map((font) => (
                <li key={font.family}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={font.family === value}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      font.family === value
                        ? "bg-accent-soft text-accent-soft-foreground"
                        : "hover:bg-default/60",
                    )}
                    style={{ fontFamily: `"${font.family}"` }}
                    onClick={() => select(font.family)}
                  >
                    {font.family}
                  </button>
                </li>
              ))}

              {options.length === 0 && (
                <li className="px-2 py-3 text-xs text-muted">没有匹配的字体</li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Option grid                                                                 */
/* -------------------------------------------------------------------------- */

/** Grid of selectable cards, used for the accent and code-background pickers. */
export function OptionGrid({ children, columns = 3 }: { children: ReactNode; columns?: number }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

export function OptionCard({
  selected,
  onSelect,
  label,
  children,
  style,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-all",
        selected ? "shadow-sm" : "border-border/70 hover:bg-default/40",
      )}
      style={
        selected
          ? { ...style, borderColor: "var(--qj-accent)", boxShadow: "0 0 0 1px var(--qj-accent)" }
          : style
      }
    >
      {children}
      <span className={cn("text-xs", selected ? "font-medium" : "text-muted")}>{label}</span>
    </button>
  );
}
