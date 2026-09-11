import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

import type { CodeBackgroundName } from "@/types";

/** Backgrounds light enough that a dark syntax palette would be unreadable. */
const LIGHT_CODE_BACKGROUNDS: readonly CodeBackgroundName[] = ["cloud", "sand", "celadon"];

export function isLightCodeBackground(name: CodeBackgroundName): boolean {
  return LIGHT_CODE_BACKGROUNDS.includes(name);
}

/**
 * Light counterpart to Crepe's built-in `oneDark`.
 *
 * Crepe hardcodes `oneDark` for code blocks, whose palette is designed for a
 * dark surface. The six code backgrounds split into light and dark groups, so
 * the syntax theme has to follow the chosen background rather than the app's
 * light/dark mode — otherwise pale tokens land on a near-white block. The block
 * background itself comes from `--qj-code-bg` (see `theme.css`); this supplies
 * the text, caret, and selection colours, while the token palette comes from
 * CodeMirror's built-in light `defaultHighlightStyle`.
 */
const lightCodeTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--qj-code-text)",
    },
    ".cm-content": {
      caretColor: "var(--qj-code-text)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--qj-code-text)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--qj-code-ln)",
      border: "none",
    },
    // Active-line tinting is owned by `theme.css`: CodeMirror marks the cursor's
    // line even when unfocused, so suppressing it needs a `.cm-focused` check
    // that a JS theme cannot express.
  },
  { dark: false },
);

/**
 * CodeMirror theme for the chosen code background.
 *
 * Crepe replaces its whole extension list when a CodeMirror feature config is
 * supplied, so the dark case must pass `oneDark` explicitly instead of relying
 * on it being merged back in as a default.
 */
export function codeThemeExtension(background: CodeBackgroundName): Extension {
  return isLightCodeBackground(background) ? lightCodeTheme : oneDark;
}
