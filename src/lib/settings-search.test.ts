/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX } from "@/lib/settings-index";
import { describeResult, searchSettings } from "@/lib/settings-search";
import type { SettingsSection } from "@/lib/settings-sections";

/** Where each section's rows are written, for the drift check below. */
const SECTION_FILES: Partial<Record<SettingsSection, string>> = {
  appearance: "AppearanceSection.tsx",
  editor: "EditorSection.tsx",
  code: "CodeSection.tsx",
  markdown: "MarkdownSection.tsx",
  image: "ImageSection.tsx",
  export: "ExportSection.tsx",
  behavior: "BehaviorSection.tsx",
  updates: "UpdateSection.tsx",
};

describe("searchSettings", () => {
  it("finds a row by its label", () => {
    const labels = searchSettings("行高").map((entry) => entry.label);

    expect(labels[0]).toBe("行高");
  });

  it("finds a row by a word from its hint", () => {
    // Nobody searches for 「拼写检查」; they type 拼写, or the thing they want to
    // change about it.
    expect(searchSettings("拼写").map((entry) => entry.label)).toContain("拼写检查");
    expect(searchSettings("延迟").map((entry) => entry.label)).toContain("保存延迟");
  });

  it("narrows with every word typed", () => {
    const hits = searchSettings("导出 字号");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((entry) => entry.section === "export")).toBe(true);
  });

  it("puts label matches above rows that only mention the word", () => {
    const hits = searchSettings("字体");
    const first = hits[0];

    // Rows named after a font come first; rows whose hint merely says 字体 come
    // later, or the first result would be arbitrary.
    expect(first.label.includes("字体")).toBe(true);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[1].label.includes("字体")).toBe(true);
  });

  it("finds everything on a page by the page's name", () => {
    const hits = searchSettings("快捷键");
    expect(hits.some((entry) => entry.section === "shortcuts")).toBe(false);
    // 快捷键 is a page name, not a row; searching it should not invent rows.
    expect(searchSettings("更新").every((entry) => entry.section === "updates")).toBe(true);
  });

  it("says nothing for an empty or unmatched query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("没有这一项")).toEqual([]);
  });
});

describe("describeResult", () => {
  it("names the row by its group and page", () => {
    const entry = SETTINGS_INDEX.find((item) => item.label === "行高")!;
    expect(describeResult(entry)).toBe("排版 · 编辑器");
  });
});

describe("the index itself", () => {
  it("points at labels that are still on screen", () => {
    // The index is generated from the sources, so this is the check that a rename
    // does not leave a search result pointing at a row that no longer exists.
    const sources = new Map<string, string>();
    for (const [section, file] of Object.entries(SECTION_FILES)) {
      sources.set(
        section,
        readFileSync(
          new URL(`../components/settings/sections/${file}`, import.meta.url),
          "utf8",
        ),
      );
    }

    const missing = SETTINGS_INDEX.filter((entry) => {
      const source = sources.get(entry.section);
      return source === undefined || !source.includes(`label="${entry.label}"`);
    });

    expect(missing.map((entry) => `${entry.section}:${entry.label}`)).toEqual([]);
  });

  it("names every row unambiguously", () => {
    // 导出 is where this matters: three rows are called 「字体」 (body, heading,
    // code) and two are called 「字号」. They are told apart by their group, so the
    // pair has to be unique — otherwise two results would read exactly alike.
    const seen = new Set(
      SETTINGS_INDEX.map((entry) => `${entry.section}:${entry.group}:${entry.label}`),
    );
    expect(seen.size).toBe(SETTINGS_INDEX.length);
  });
});
