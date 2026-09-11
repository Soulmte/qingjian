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

/** Grouping used by the dialog's navigation rail. */
export const SETTINGS_NAV: { group: string; sections: SettingsSection[] }[] = [
  { group: "写作外观", sections: ["appearance", "editor", "code"] },
  { group: "内容处理", sections: ["markdown", "image", "export"] },
  { group: "应用", sections: ["behavior", "shortcuts"] },
  { group: "关于", sections: ["updates", "about"] },
];
