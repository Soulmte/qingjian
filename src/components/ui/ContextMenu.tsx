import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import {
  isMenuItem,
  menuItems,
  useContextMenu,
  type ContextMenuItem,
} from "@/lib/context-menu";

/** Keep panels this far from the window edge. */
const EDGE = 8;
/** Gap between a parent row and its submenu. */
const GAP = 2;

interface Point {
  left: number;
  top: number;
}

/**
 * The app's right-click menu, with one level of cascading submenus.
 *
 * Positioned at the pointer rather than anchored to an element, so it cannot
 * reuse `PopoverMenu` (which measures a trigger). It is portalled to `body` for
 * the same reasons that one is: an ancestor with `overflow` would clip it, and
 * inside the settings dialog React Aria sets `inert` on everything outside the
 * modal — `data-react-aria-top-layer` is what stops the menu from being
 * unclickable there.
 *
 * Two details about submenus are load-bearing:
 *
 * 1. They open on hover and are *not* closed by leaving the parent row. The
 *    pointer has to cross the gap to reach them, so a `mouseleave` would shut
 *    the panel before it could be used; they close when another row is hovered,
 *    when the menu closes, or on Escape.
 * 2. Navigation state is reset when a *menu* opens, never from the effect that
 *    registers the listeners — that effect depends on which submenu is open, so
 *    resetting there closed the submenu in the same tick it was opened.
 */
export function ContextMenu() {
  const menu = useContextMenu((state) => state.menu);
  const close = useContextMenu((state) => state.close);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const [position, setPosition] = useState<Point | null>(null);
  const [submenuAt, setSubmenuAt] = useState<Point | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [activeSub, setActiveSub] = useState(-1);

  const items = useMemo(() => (menu ? menuItems(menu.entries) : []), [menu]);
  const openItem = items.find((item) => item.id === openId) ?? null;
  const subEntries = useMemo(
    () => (openItem?.submenu ? menuItems(openItem.submenu) : []),
    [openItem],
  );

  // Read by the key handler, which must not re-subscribe as the user moves
  // around — re-registering listeners on every hover is both wasteful and, as
  // described above, was how the submenu kept closing itself.
  const nav = useRef({ items, subEntries, active, activeSub, openId });
  nav.current = { items, subEntries, active, activeSub, openId };

  const [openedMenu, setOpenedMenu] = useState(menu);
  if (menu !== openedMenu) {
    setOpenedMenu(menu);
    setActive(-1);
    setActiveSub(-1);
    setOpenId(null);
  }

  // Measured after mount so a menu opened near an edge can be pulled back in.
  useLayoutEffect(() => {
    if (!menu) {
      setPosition(null);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE, Math.min(menu.x, window.innerWidth - rect.width - EDGE)),
      top: Math.max(EDGE, Math.min(menu.y, window.innerHeight - rect.height - EDGE)),
    });
  }, [menu]);

  // The submenu is placed from its parent row, flipping inward when the right
  // edge is too close — otherwise a menu opened near the right of the window
  // would push its submenu off screen.
  useLayoutEffect(() => {
    if (!openId) {
      setSubmenuAt(null);
      return;
    }
    const anchor = itemRefs.current.get(openId);
    const panel = submenuRef.current;
    if (!anchor || !panel) return;

    const row = anchor.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const fitsRight = row.right + GAP + rect.width + EDGE <= window.innerWidth;

    setSubmenuAt({
      left: fitsRight ? row.right + GAP : Math.max(EDGE, row.left - rect.width - GAP),
      top: Math.max(EDGE, Math.min(row.top - 6, window.innerHeight - rect.height - EDGE)),
    });
  }, [openId, subEntries.length]);

  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      // A dropdown's own trigger has to stay clickable, or pressing it a second
      // time would close the menu on mousedown and reopen it on click.
      if (menu.anchor?.contains(target)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const { items, subEntries, active, activeSub, openId } = nav.current;
      const inSubmenu = openId !== null && activeSub >= 0;

      if (event.key === "Escape") {
        event.stopPropagation();
        if (openId !== null) setOpenId(null);
        else close();
        return;
      }

      if (event.key === "ArrowLeft" && openId !== null) {
        event.preventDefault();
        setOpenId(null);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const list = inSubmenu ? subEntries : items;
        if (list.length === 0) return;
        const current = inSubmenu ? activeSub : active;
        const next = (current + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        if (inSubmenu) setActiveSub(next);
        else setActive(next);
        return;
      }

      if (event.key === "ArrowRight") {
        const item = items[active];
        if (!item?.submenu) return;
        event.preventDefault();
        setOpenId(item.id);
        setActiveSub(0);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        const item = inSubmenu ? subEntries[activeSub] : items[active];
        if (!item || item.disabled) return;
        event.preventDefault();
        if (item.submenu) {
          setOpenId(item.id);
          setActiveSub(0);
          return;
        }
        item.run?.();
        close();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;

  const activate = (item: ContextMenuItem) => {
    if (item.disabled) return;
    if (item.submenu) {
      setOpenId(item.id);
      setActiveSub(0);
      return;
    }
    item.run?.();
    close();
  };

  const renderEntries = (entries: typeof menu.entries, level: "root" | "sub") => {
    const list = menuItems(entries);
    const currentIndex = level === "root" ? active : activeSub;

    return entries.map((entry, index) => {
      if (isMenuItem(entry)) {
        return (
          <MenuRow
            key={entry.id}
            item={entry}
            active={list[currentIndex]?.id === entry.id}
            open={openId === entry.id}
            register={
              level === "root"
                ? (node) => {
                    if (node) itemRefs.current.set(entry.id, node);
                    else itemRefs.current.delete(entry.id);
                  }
                : undefined
            }
            onHover={() => {
              if (level === "root") setOpenId(entry.submenu ? entry.id : null);
            }}
            onActivate={() => activate(entry)}
          />
        );
      }

      if ("heading" in entry) {
        return (
          <p key={`${level}-heading-${index}`} className="qj-menu-heading">
            {entry.heading}
          </p>
        );
      }

      return (
        <div
          key={`${level}-row-${index}`}
          className="qj-menu-segments"
          role="radiogroup"
          aria-label="选项"
        >
          {entry.row.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.selected ?? false}
              title={`${item.description ?? item.label}${item.chord ? `（${item.chord}）` : ""}`}
              disabled={item.disabled}
              className={cn(
                "qj-menu-segment",
                item.selected && "is-selected",
                list[currentIndex]?.id === item.id && "is-active",
              )}
              onMouseEnter={() => level === "root" && setOpenId(null)}
              onClick={() => activate(item)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      );
    });
  };

  return createPortal(
    <>
      <div
        ref={panelRef}
        role="menu"
        aria-label="右键菜单"
        className="qj-popover qj-context-menu"
        data-react-aria-top-layer=""
        style={{
          left: position?.left ?? menu.x,
          top: position?.top ?? menu.y,
          // The first paint is used for measurement only; showing it would flash
          // the menu at the pointer before it snaps inside the window.
          visibility: position ? "visible" : "hidden",
        }}
      >
        {renderEntries(menu.entries, "root")}
      </div>

      {openItem?.submenu && (
        <div
          ref={submenuRef}
          role="menu"
          aria-label={openItem.label}
          className="qj-popover qj-context-menu"
          data-react-aria-top-layer=""
          style={{
            left: submenuAt?.left ?? 0,
            top: submenuAt?.top ?? 0,
            visibility: submenuAt ? "visible" : "hidden",
          }}
        >
          {renderEntries(openItem.submenu, "sub")}
        </div>
      )}
    </>,
    document.body,
  );
}

function MenuRow({
  item,
  active,
  open,
  register,
  onHover,
  onActivate,
}: {
  item: ContextMenuItem;
  /** Highlighted by keyboard navigation. */
  active: boolean;
  /** This row's submenu is currently open. */
  open: boolean;
  register?: (node: HTMLButtonElement | null) => void;
  onHover: () => void;
  onActivate: () => void;
}) {
  const hasSubmenu = item.submenu !== undefined;

  return (
    <button
      ref={register}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={cn(
        "qj-menu-item",
        item.danger && "is-danger",
        item.disabled && "is-disabled",
        (active || open) && "is-active",
      )}
      aria-haspopup={hasSubmenu || undefined}
      aria-expanded={hasSubmenu ? open : undefined}
      onMouseEnter={onHover}
      onClick={onActivate}
    >
      <span className="qj-menu-item__icon">{item.icon}</span>
      <span className="qj-menu-item__label">{item.label}</span>
      {item.chord && <span className="qj-menu-item__chord">{item.chord}</span>}
      {hasSubmenu && <span className="qj-menu-item__arrow">›</span>}
    </button>
  );
}
