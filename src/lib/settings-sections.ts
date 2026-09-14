/**
 * Settings sections. Kept out of the dialog component so stores and shortcuts
 * can refer to a section without importing UI code.
 */
export type SettingsSection =
  | "appearance"
  | "editor"
  | "code"
  | "markdown"
  | "image"
  | "export"
  | "behavior"
  | "shortcuts"
  | "updates"
  | "about";

/**
 * The name each section shows, in the rail and in the header.
 *
 * Kept here rather than in the dialog so the settings search can label its
 * results (「行高 · 排版 · 编辑器」) without importing UI code.
 */
export const SECTION_TITLES: Record<SettingsSection, string> = {
  appearance: "外观",
  editor: "编辑器",
  code: "代码",
  markdown: "Markdown",
  image: "图像",
  export: "导出",
  behavior: "行为",
  shortcuts: "快捷键",
  updates: "更新",
  about: "关于",
};

/** Grouping used by the dialog's navigation rail. */
export const SETTINGS_NAV: { group: string; sections: SettingsSection[] }[] = [
  { group: "写作外观", sections: ["appearance", "editor", "code"] },
  { group: "内容处理", sections: ["markdown", "image", "export"] },
  { group: "应用", sections: ["behavior", "shortcuts"] },
  { group: "关于", sections: ["updates", "about"] },
];

/**
 * Which settings each section owns.
 *
 * Two things need this: the per-section "恢复本页默认" button, and the reset that
 * spells out what it will clear. Every key in the app has to appear in exactly one
 * list — a test enforces that, so a new setting cannot quietly end up in no
 * section at all (and therefore be left behind by every reset).
 *
 * `shortcuts` and `about` show no settings of their own.
 */
export const SECTION_KEYS: Record<SettingsSection, string[]> = {
  appearance: ["theme", "accent", "uiFont", "radius", "zoom"],
  editor: [
    "fontSize",
    "lineHeight",
    "editorWidth",
    "editorFont",
    "spellCheck",
    "focusMode",
    "typewriterMode",
  ],
  code: ["codeBackground", "codeFont", "codeFontSize"],
  markdown: [
    "mathEnabled",
    "tableEnabled",
    "codeHighlightEnabled",
    "linkTooltipEnabled",
    "blockHandleEnabled",
  ],
  image: [
    "imageDir",
    "imageAutoInsert",
    "imageMaxWidth",
    "imageUploadMode",
    "gitProvider",
    "gitRepo",
    "gitBranch",
    "gitImageDir",
    "gitRepoPublic",
  ],
  export: [
    "exportFormat",
    "exportBodyFont",
    "exportBodyFontSize",
    "exportBodyLineHeight",
    "exportHeadingFont",
    "exportHeadingBold",
    "exportHeadingColor",
    "exportHeadingSizes",
    "exportHeadingSpaceBefore",
    "exportHeadingSpaceAfter",
    "exportCodeFont",
    "exportCodeFontSize",
    "exportCodeBackground",
    "exportPageSize",
    "exportMarginTop",
    "exportMarginBottom",
    "exportMarginLeft",
    "exportMarginRight",
    "exportTableBorders",
    "exportTableHeaderFill",
    "exportImageMaxWidth",
    "exportIncludeTitle",
  ],
  behavior: [
    "autoSave",
    "autoSaveDelay",
    "confirmBeforeDelete",
    "restoreLastWorkspace",
    "showSidebar",
    "showOutline",
    "sidebarWidth",
  ],
  updates: ["autoCheckUpdate", "lastUpdateCheck", "updateProxy"],
  shortcuts: [],
  about: [],
};
