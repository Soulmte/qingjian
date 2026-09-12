import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

interface ToolbarButtonProps {
  /** Used as the accessible name and the native tooltip. */
  label: string;
  /**
   * Text drawn under the icon.
   *
   * Only the top bar passes this. A lone close or delete button has no room for
   * a word and nothing to disambiguate, so it stays a square icon there.
   */
  text?: string;
  onPress: () => void;
  children: ReactNode;
  /** Renders the pressed state for toggles such as the outline panel. */
  active?: boolean;
  /** `accent` tints the button; `danger` marks a destructive action. */
  tone?: "default" | "accent" | "danger";
  disabled?: boolean;
  className?: string;
  /**
   * The underlying element.
   *
   * A button that opens a dropdown needs its own rect to place the panel under
   * itself; React 19 passes `ref` as an ordinary prop, so this is a plain entry
   * in the props rather than a wrapper component.
   */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Minimal action button for the app chrome.
 *
 * HeroUI's icon-only button renders as a circle, which reads too heavy in a
 * flat toolbar. This keeps a comfortable hit area with a small radius and a
 * quiet hover tint, so the chrome stays out of the way without losing polish.
 */
export function ToolbarButton({
  label,
  text,
  onPress,
  children,
  active = false,
  tone = "default",
  disabled = false,
  className,
  ref,
}: ToolbarButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "tb-btn",
        text !== undefined && "tb-btn--text",
        tone === "accent" && "tb-btn--accent",
        tone === "danger" && "tb-btn--danger",
        className,
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
      {text !== undefined && <span className="tb-btn__label">{text}</span>}
    </button>
  );
}
