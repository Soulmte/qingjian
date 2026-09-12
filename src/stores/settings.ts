import { create } from "zustand";

import { api, errorMessage } from "@/lib/api";
import type { AccentName, AppSettings, CodeBackgroundName, ThemeMode } from "@/types";

export const defaultSettings: AppSettings = {
  theme: "system",
  accent: "bamboo",
  uiFont: "",
  radius: 12,
  zoom: 1,

  fontSize: 16,
  lineHeight: 1.75,
  editorWidth: 760,
  editorFont: "",
  spellCheck: true,
  focusMode: false,
  typewriterMode: false,

  codeBackground: "cloud",
  codeFont: "",
  codeFontSize: 14,

  mathEnabled: true,
  tableEnabled: true,
  codeHighlightEnabled: true,
  linkTooltipEnabled: true,
  blockHandleEnabled: true,

  imageDir: "assets",
  imageAutoInsert: true,
  imageMaxWidth: 100,

  imageUploadMode: "local",
  gitProvider: "github",
  gitRepo: "",
  gitBranch: "main",
  gitImageDir: "assets",
  gitRepoPublic: true,

  autoSave: true,
  autoSaveDelay: 800,
  confirmBeforeDelete: true,
  restoreLastWorkspace: true,
  showSidebar: true,
  showOutline: true,
  sidebarWidth: 264,

  exportFormat: "docx",
  exportBodyFont: "",
  exportBodyFontSize: 12,
  exportBodyLineHeight: 1.7,
  exportHeadingFont: "",
  exportHeadingBold: true,
  exportHeadingColor: "",
  // 逐级缩小的默认阶梯，与阅读密度匹配；用户可在设置里逐级覆盖。
  exportHeadingSizes: [22, 18, 16, 14, 13, 12],
  exportHeadingSpaceBefore: 14,
  exportHeadingSpaceAfter: 8,
  exportCodeFont: "",
  exportCodeFontSize: 10,
  exportCodeBackground: "",
  exportPageSize: "a4",
  exportMarginTop: 20,
  exportMarginBottom: 20,
  exportMarginLeft: 22,
  exportMarginRight: 22,
  exportTableBorders: true,
  exportTableHeaderFill: "",
  exportImageMaxWidth: 100,
  exportIncludeTitle: true,

  autoCheckUpdate: true,
  lastUpdateCheck: "",
};

export const ACCENTS: AccentName[] = [
  "bamboo",
  "ink",
  "rouge",
  "ochre",
  "violet",
  "teal",
  "mono",
  "gamboge",
  "idea",
];
export const CODE_BACKGROUNDS: CodeBackgroundName[] = [
  "cloud",
  "sand",
  "celadon",
  "graphite",
  "jade",
  "space",
];

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/*                                                                            */
/* Stored values are user-editable JSON, so every field is validated against   */
/* the defaults instead of being trusted. A malformed value silently falls     */
/* back to its default rather than breaking the settings screen.               */
/* -------------------------------------------------------------------------- */

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return fallback;
  return trimmed;
}

/**
 * A colour the user typed, or the empty string for "renderer default".
 *
 * Rejecting a malformed value here is what keeps an invalid hex out of the Word
 * style definition, where it would make Word offer to repair the document.
 */
function color(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

/** The six heading sizes, or the defaults when the stored value is not six of them. */
function headingSizes(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length !== 6) return [...fallback];
  return value.map((item, index) => clamp(item, 8, 48, fallback[index]));
}

export function sanitizeSettings(raw: Record<string, unknown>): AppSettings {
  const d = defaultSettings;
  return {
    theme: pick<ThemeMode>(raw.theme, ["light", "dark", "system"], d.theme),
    accent: pick(raw.accent, ACCENTS, d.accent),
    // Font families are free-form strings resolved against the system list; an
    // empty value means "use the built-in stack".
    uiFont: text(raw.uiFont, "", 120),
    radius: clamp(raw.radius, 8, 20, d.radius),
    zoom: clamp(raw.zoom, 0.6, 1.6, d.zoom),

    fontSize: clamp(raw.fontSize, 12, 24, d.fontSize),
    lineHeight: clamp(raw.lineHeight, 1.3, 2.4, d.lineHeight),
    editorWidth: clamp(raw.editorWidth, 560, 1400, d.editorWidth),
    editorFont: text(raw.editorFont, "", 120),
    spellCheck: bool(raw.spellCheck, d.spellCheck),
    focusMode: bool(raw.focusMode, d.focusMode),
    typewriterMode: bool(raw.typewriterMode, d.typewriterMode),

    codeBackground: pick(raw.codeBackground, CODE_BACKGROUNDS, d.codeBackground),
    codeFont: text(raw.codeFont, "", 120),
    codeFontSize: clamp(raw.codeFontSize, 11, 20, d.codeFontSize),

    mathEnabled: bool(raw.mathEnabled, d.mathEnabled),
    tableEnabled: bool(raw.tableEnabled, d.tableEnabled),
    codeHighlightEnabled: bool(raw.codeHighlightEnabled, d.codeHighlightEnabled),
    linkTooltipEnabled: bool(raw.linkTooltipEnabled, d.linkTooltipEnabled),
    blockHandleEnabled: bool(raw.blockHandleEnabled, d.blockHandleEnabled),

    imageDir: text(raw.imageDir, d.imageDir, 80),
    imageAutoInsert: bool(raw.imageAutoInsert, d.imageAutoInsert),
    imageMaxWidth: clamp(raw.imageMaxWidth, 30, 100, d.imageMaxWidth),

    imageUploadMode: pick(raw.imageUploadMode, ["local", "git"], d.imageUploadMode),
    gitProvider: pick(raw.gitProvider, ["github", "gitee"], d.gitProvider),
    gitRepo: text(raw.gitRepo, d.gitRepo, 200),
    gitBranch: text(raw.gitBranch, d.gitBranch, 120),
    gitImageDir: text(raw.gitImageDir, d.gitImageDir, 120),
    gitRepoPublic: bool(raw.gitRepoPublic, d.gitRepoPublic),

    autoSave: bool(raw.autoSave, d.autoSave),
    autoSaveDelay: clamp(raw.autoSaveDelay, 200, 5000, d.autoSaveDelay),
    confirmBeforeDelete: bool(raw.confirmBeforeDelete, d.confirmBeforeDelete),
    restoreLastWorkspace: bool(raw.restoreLastWorkspace, d.restoreLastWorkspace),
    showSidebar: bool(raw.showSidebar, d.showSidebar),
    showOutline: bool(raw.showOutline, d.showOutline),
    sidebarWidth: clamp(raw.sidebarWidth, 200, 520, d.sidebarWidth),

    exportFormat: pick(raw.exportFormat, ["docx", "pdf", "html", "txt", "md"], d.exportFormat),
    exportBodyFont: text(raw.exportBodyFont, "", 120),
    exportBodyFontSize: clamp(raw.exportBodyFontSize, 8, 24, d.exportBodyFontSize),
    exportBodyLineHeight: clamp(raw.exportBodyLineHeight, 1.1, 2.6, d.exportBodyLineHeight),
    exportHeadingFont: text(raw.exportHeadingFont, "", 120),
    exportHeadingBold: bool(raw.exportHeadingBold, d.exportHeadingBold),
    exportHeadingColor: color(raw.exportHeadingColor, ""),
    exportHeadingSizes: headingSizes(raw.exportHeadingSizes, d.exportHeadingSizes),
    exportHeadingSpaceBefore: clamp(raw.exportHeadingSpaceBefore, 0, 60, d.exportHeadingSpaceBefore),
    exportHeadingSpaceAfter: clamp(raw.exportHeadingSpaceAfter, 0, 60, d.exportHeadingSpaceAfter),
    exportCodeFont: text(raw.exportCodeFont, "", 120),
    exportCodeFontSize: clamp(raw.exportCodeFontSize, 7, 20, d.exportCodeFontSize),
    exportCodeBackground: color(raw.exportCodeBackground, ""),
    exportPageSize: pick(raw.exportPageSize, ["a4", "letter"], d.exportPageSize),
    exportMarginTop: clamp(raw.exportMarginTop, 5, 60, d.exportMarginTop),
    exportMarginBottom: clamp(raw.exportMarginBottom, 5, 60, d.exportMarginBottom),
    exportMarginLeft: clamp(raw.exportMarginLeft, 5, 60, d.exportMarginLeft),
    exportMarginRight: clamp(raw.exportMarginRight, 5, 60, d.exportMarginRight),
    exportTableBorders: bool(raw.exportTableBorders, d.exportTableBorders),
    exportTableHeaderFill: color(raw.exportTableHeaderFill, ""),
    exportImageMaxWidth: clamp(raw.exportImageMaxWidth, 20, 100, d.exportImageMaxWidth),
    exportIncludeTitle: bool(raw.exportIncludeTitle, d.exportIncludeTitle),

    // `owner/repo` 里不会有空格，所以 text() 的空白修剪正好合适。空串在这里
    // 是有意义的值（「还没查过」），而 text() 恰好把空串当默认值返回。
    autoCheckUpdate: bool(raw.autoCheckUpdate, d.autoCheckUpdate),
    lastUpdateCheck: text(raw.lastUpdateCheck, "", 40),
  };
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  error: null,

  load: async () => {
    try {
      const raw = await api.loadSettings();
      set({ settings: sanitizeSettings(raw), loaded: true, error: null });
    } catch (error) {
      // Falling back to defaults keeps the app usable; the error is surfaced
      // so a broken database is not silently hidden.
      set({ settings: defaultSettings, loaded: true, error: errorMessage(error) });
    }
  },

  update: (key, value) => {
    set({ settings: { ...get().settings, [key]: value } });
    void api.setSetting(key, value);
  },

  reset: () => {
    const current = get().settings;
    set({ settings: defaultSettings });
    // Persist every key, not just the ones that changed, so the database and
    // the in-memory defaults cannot drift apart.
    for (const key of Object.keys(defaultSettings) as (keyof AppSettings)[]) {
      if (current[key] !== defaultSettings[key]) {
        void api.setSetting(key, defaultSettings[key]);
      }
    }
  },
}));
