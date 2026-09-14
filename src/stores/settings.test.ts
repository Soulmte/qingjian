import { describe, expect, it } from "vitest";

import { SECTION_KEYS } from "@/lib/settings-sections";
import { defaultSettings, isAtDefault, sectionChanged } from "@/stores/settings";

describe("settings sections", () => {
  it("gives every setting exactly one home", () => {
    // The per-section reset walks these lists, so a key that belongs to no
    // section would silently survive every reset — and one listed twice would be
    // reset by a page it does not appear on.
    const owned = Object.entries(SECTION_KEYS).flatMap(([section, keys]) =>
      keys.map((key) => [key, section] as const),
    );
    const byKey = new Map<string, string[]>();
    for (const [key, section] of owned) {
      byKey.set(key, [...(byKey.get(key) ?? []), section]);
    }

    const missing = Object.keys(defaultSettings).filter((key) => !byKey.has(key));
    const duplicated = [...byKey.entries()].filter(([, sections]) => sections.length > 1);

    expect(missing, "没有归属的设置项，任何一次恢复默认都会漏掉它们").toEqual([]);
    expect(duplicated, "同一个设置项被两页同时认领").toEqual([]);
  });

  it("lists no key that is not a setting", () => {
    const known = new Set(Object.keys(defaultSettings));
    const unknown = Object.values(SECTION_KEYS)
      .flat()
      .filter((key) => !known.has(key));

    expect(unknown).toEqual([]);
  });
});

describe("isAtDefault", () => {
  it("treats an equal array as the default", () => {
    // The heading sizes are an array, so a copy holding the same numbers has to
    // count as untouched — otherwise every page would look modified.
    const copy = { ...defaultSettings, exportHeadingSizes: [...defaultSettings.exportHeadingSizes] };

    expect(isAtDefault(copy, "exportHeadingSizes")).toBe(true);
    expect(isAtDefault({ ...copy, exportHeadingSizes: [1, 2, 3, 4, 5, 6] }, "exportHeadingSizes")).toBe(
      false,
    );
  });

  it("reports a changed scalar", () => {
    expect(isAtDefault(defaultSettings, "fontSize")).toBe(true);
    expect(isAtDefault({ ...defaultSettings, fontSize: 20 }, "fontSize")).toBe(false);
  });
});

describe("sectionChanged", () => {
  it("only reports the page that was touched", () => {
    const settings = { ...defaultSettings, gitRepo: "soulmte/qingjian" };

    expect(sectionChanged(settings, "image")).toBe(true);
    expect(sectionChanged(settings, "export")).toBe(false);
    expect(sectionChanged(settings, "behavior")).toBe(false);
  });

  it("says nothing is changed for the pages that own no settings", () => {
    expect(sectionChanged(defaultSettings, "shortcuts")).toBe(false);
    expect(sectionChanged(defaultSettings, "about")).toBe(false);
  });
});
