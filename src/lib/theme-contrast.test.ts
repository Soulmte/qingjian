/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACCENTS } from "@/stores/settings";

/**
 * Guards the popup palette in `src/styles/theme.css`.
 *
 * Two failure modes have shipped here before, and both were invisible until a
 * human stared at the window:
 *
 *   1. The popup surface resolved to the paper colour, so menus were the same
 *      colour as the page they floated over.
 *   2. The icon colour resolved to a hairline border token, so menu icons sat
 *      near 1.2:1 against their own background.
 *
 * The contrast half of this file recomputes the palette with the same
 * `color-mix(in oklab, …)` semantics the browser uses (CSS Color 4) and asserts
 * WCAG ratios. The wiring half reads the stylesheets and asserts the mappings
 * that caused the bugs above are still in place.
 */

/* -------------------------------------------------------------------------- */
/* Colour maths                                                                */
/* -------------------------------------------------------------------------- */

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as Rgb;
}

function rgbToHex([r, g, b]: Rgb): string {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [lr, lg, lb].map(linearToSrgb) as Rgb;
}

/** `color-mix(in oklab, first amount%, second)`, both opaque. */
function mixOklab(firstHex: string, amount: number, secondHex: string): string {
  const first = rgbToOklab(hexToRgb(firstHex));
  const second = rgbToOklab(hexToRgb(secondHex));
  const t = amount / 100;
  return rgbToHex(oklabToRgb(first.map((value, i) => value * t + second[i] * (1 - t)) as Rgb));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(aHex: string, bHex: string): number {
  const [hi, lo] = [relativeLuminance(aHex), relativeLuminance(bHex)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------------------------------------------------- */
/* Palette (mirrors the derived blocks in theme.css)                           */
/* -------------------------------------------------------------------------- */

const ACCENTS_PALETTE = {
  /** 竹青 */
  bamboo: { light: "#017b40", dark: "#53cd80", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 墨蓝 */
  ink: { light: "#2e69c4", dark: "#81b2ff", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 胭脂 */
  rouge: { light: "#ad3c6f", dark: "#fc84b4", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 赭石 */
  ochre: { light: "#a35301", dark: "#fb9344", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 黛紫 */
  violet: { light: "#7454ba", dark: "#b89eff", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 苍碧 */
  teal: { light: "#047773", dark: "#02cbc3", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 墨白 */
  mono: { light: "#2f2d2c", dark: "#d7d4d1", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** 藤黄 */
  gamboge: { light: "#8d6d01", dark: "#daaa02", textLight: "#ffffff", textDark: "#0e0d0b" },
  /** IDEA 蓝 */
  idea: { light: "#2669ed", dark: "#4785ff", textLight: "#ffffff", textDark: "#0e0d0b" },
} as const;

type Mode = "light" | "dark";

interface ModeConfig {
  base: { bg: string; paper: string; text: string };
  tint: {
    bg: number;
    paper: number;
    text: number;
    /** Accent share of the selected-row surface (`--qj-accent-light`). */
    soft: number;
    /** Accent share of the text drawn on it (`--qj-accent-strong`). */
    strong: number;
  };
  elevated: { anchor: string; amount: number };
  menuIcon: { anchor: string; amount: number };
  menuBorder: { anchor: string; amount: number };
  /**
   * How the popup separates from the page. Light mode cannot do it by
   * lightness (paper is already white), so it leans on the border instead.
   */
  separation: "border" | "surface";
}

const MODES: Record<Mode, ModeConfig> = {
  light: {
    base: { bg: "#f3efec", paper: "#fcfaf7", text: "#252220" },
    tint: { bg: 2, paper: 1.5, text: 2.5, soft: 7, strong: 74 },
    elevated: { anchor: "#fefefd", amount: 1.5 },
    menuIcon: { anchor: "#5c5750", amount: 8 },
    menuBorder: { anchor: "#d1cbc4", amount: 6 },
    separation: "border",
  },
  dark: {
    base: { bg: "#181613", paper: "#21201e", text: "#eae7e3" },
    tint: { bg: 3, paper: 2, text: 3, soft: 14, strong: 78 },
    elevated: { anchor: "#2b2a28", amount: 5 },
    menuIcon: { anchor: "#b9b3a9", amount: 8 },
    menuBorder: { anchor: "#4c4741", amount: 8 },
    separation: "surface",
  },
};

/** WCAG minimums. Icons are non-text UI, so 4.5:1 is stricter than the 3:1 floor. */
const MIN_ICON_CONTRAST = 4.5;
const MIN_TEXT_CONTRAST = 7;
const MIN_BORDER_CONTRAST = 1.3;
const MIN_SEPARATION = { border: 1.4, surface: 1.15 } as const;

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

describe.each(Object.entries(MODES))("popup contrast / %s", (mode, config) => {
  const typed = mode as Mode;

  describe.each(Object.entries(ACCENTS_PALETTE))("accent %s", (_name, accent) => {
    const colour = accent[typed];
    const accentText = typed === "light" ? accent.textLight : accent.textDark;
    const elevated = mixOklab(colour, config.elevated.amount, config.elevated.anchor);
    const menuIcon = mixOklab(colour, config.menuIcon.amount, config.menuIcon.anchor);
    const menuBorder = mixOklab(colour, config.menuBorder.amount, config.menuBorder.anchor);
    const text = mixOklab(colour, config.tint.text, config.base.text);
    const paper = mixOklab(colour, config.tint.paper, config.base.paper);
    const page = mixOklab(colour, config.tint.bg, config.base.bg);

    it("menu icons are legible on the popup surface", () => {
      expect(contrast(menuIcon, elevated)).toBeGreaterThanOrEqual(MIN_ICON_CONTRAST);
    });

    // Buttons and selected rows paint the accent-foreground on the accent fill.
    it("the accent foreground is legible on the accent fill", () => {
      expect(contrast(accentText, colour)).toBeGreaterThanOrEqual(4.5);
    });

    // The selected row is the accent used as *text* on a tint of itself. Holding
    // the accent light enough to read there would rule out reference colours like
    // macOS blue, so the text comes from `--qj-accent-strong` instead, and this is
    // what keeps that derivation honest.
    it("the selected row reads: accent-strong on accent-light", () => {
      const soft = mixOklab(colour, config.tint.soft, config.base.paper);
      const strong = mixOklab(colour, config.tint.strong, config.base.text);
      expect(contrast(strong, soft)).toBeGreaterThanOrEqual(4.5);
    });

    // Links and other accent-coloured text sit on the paper itself.
    it("the accent is legible as text on the paper", () => {
      expect(contrast(colour, paper)).toBeGreaterThanOrEqual(4.5);
    });

    it("menu text is legible on the popup surface", () => {
      expect(contrast(text, elevated)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });

    it("the popup border reads against its own surface", () => {
      expect(contrast(menuBorder, elevated)).toBeGreaterThanOrEqual(MIN_BORDER_CONTRAST);
    });

    it(`the popup separates from the page by ${config.separation}`, () => {
      const ratio =
        config.separation === "border"
          ? contrast(menuBorder, elevated)
          : contrast(elevated, paper);
      expect(ratio).toBeGreaterThanOrEqual(MIN_SEPARATION[config.separation]);
    });

    it("the popup surface is distinguishable from the page background", () => {
      expect(contrast(elevated, page)).toBeGreaterThanOrEqual(1.04);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Wiring                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads the stylesheet from disk.
 *
 * Vitest stubs CSS imports (`css: false`), and that stub wins over Vite's
 * `?raw` query, so the source has to be read directly. The path is resolved
 * relative to this file, which keeps it working from any cwd.
 */
const readStyle = (name: string) =>
  readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8");

const themeCss = readStyle("theme.css");
const editorCss = readStyle("editor.css");

const POPUP_TOKENS = [
  "--qj-bg-elevated",
  "--qj-bg-elevated-low",
  "--qj-menu-icon",
  "--qj-menu-border",
  "--qj-menu-hover",
  "--qj-menu-selected",
  "--qj-menu-shadow",
];

describe("popup palette declarations", () => {
  // A token defined for only one mode silently falls back to the inherited
  // value in the other, which is how the popup surface lost its colour before.
  it.each(POPUP_TOKENS)("%s is declared for both light and dark", (token) => {
    const declarations = themeCss.match(new RegExp(`${token}:`, "g")) ?? [];
    expect(declarations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Crepe variable wiring", () => {
  it("gives `outline` a real foreground, not a hairline border token", () => {
    expect(editorCss).toMatch(/--crepe-color-outline:\s*var\(--qj-menu-icon\)/);
    expect(editorCss).not.toMatch(/--crepe-color-outline:\s*var\(--separator\)/);
  });

  it("floats popups on the elevated surface rather than the paper", () => {
    expect(editorCss).toMatch(/--crepe-color-surface:\s*var\(--qj-bg-elevated\)/);
  });

  it("keeps a real shadow on popups", () => {
    expect(editorCss).not.toMatch(/--crepe-shadow-[12]:\s*none/);
    expect(editorCss).toMatch(/--crepe-shadow-1:\s*var\(--qj-menu-shadow\)/);
  });

  it("does not reference the non-existent `--field` token", () => {
    expect(editorCss).not.toMatch(/var\(--field\)/);
  });
});

describe("code block chrome", () => {
  // CodeMirror marks the cursor's line as active regardless of focus, so an
  // unscoped rule highlights the first line of every block in the document.
  it("scopes the active-line tint to the focused editor", () => {
    expect(themeCss).toMatch(/\.cm-editor\.cm-focused\s+\.cm-activeLine/);
  });
});

describe("accent palette", () => {
  // The accent name lives in three places — the union type, the store's list and
  // the stylesheet. Adding one to only two of them silently drops the setting.
  it.each(ACCENTS)("declares light and dark blocks for %s", (accent) => {
    expect(themeCss).toContain(`[data-qj-accent="${accent}"]`);
    expect(themeCss).toContain(`html.dark[data-qj-accent="${accent}"]`);
    expect(themeCss).toContain(`html.dark [data-qj-accent="${accent}"]`);
  });

  it("covers exactly the accents the contrast checks model", () => {
    expect(new Set(ACCENTS)).toEqual(new Set(Object.keys(ACCENTS_PALETTE)));
  });
});
