import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface ToolbarButtonProps {
  /** Used as the accessible name and the native tooltip. */
  label: string;
  onPress: () => void;
  children: ReactNode;
  /** Renders the pressed state for toggles such as the outline panel. */
  active?: boolean;
  /** `accent` tints the button; `danger` marks a destructive action. */
  tone?: "default" | "accent" | "danger";
  disabled?: boolean;
  className?: string;
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
  onPress,
  children,
  active = false,
  tone = "default",
  disabled = false,
  className,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "tb-btn",
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
    </button>
  );
}
