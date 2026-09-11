import { useEffect } from "react";

import { fontStack, UI_FONT_FALLBACK } from "@/lib/fonts";
import { useSettings } from "@/stores/settings";
import type { ThemeMode } from "@/types";

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * HeroUI reads its theme from the root element and `theme.css` keys both the
 * base palette and the accent palette off `class` / `data-theme`. The stored
 * choice lives in SQLite (`setting.theme`), keeping one source of truth for
 * every preference.
 */
function applyThemeMode(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/** Applies the parts of the theme that are not light/dark: accent, font, radius. */
function applyAppearance(accent: string, uiFont: string, radius: number): void {
  const root = document.documentElement;

  root.dataset.qjAccent = accent;
  root.style.setProperty("--qj-radius", `${radius}px`);

  if (uiFont) {
    root.style.setProperty("--qj-font", fontStack(uiFont, UI_FONT_FALLBACK));
  } else {
    // Dropping the inline value lets the stylesheet default take over again.
    root.style.removeProperty("--qj-font");
  }
}

/** Keeps the document in sync with the stored theme, following the OS while `system`. */
export function useThemeSync(): void {
  const theme = useSettings((state) => state.settings.theme);
  const accent = useSettings((state) => state.settings.accent);
  const uiFont = useSettings((state) => state.settings.uiFont);
  const radius = useSettings((state) => state.settings.radius);
  const loaded = useSettings((state) => state.loaded);

  useEffect(() => {
    if (!loaded) return;

    applyThemeMode(theme);
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeMode("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    applyAppearance(accent, uiFont, radius);
  }, [accent, uiFont, radius, loaded]);
}
