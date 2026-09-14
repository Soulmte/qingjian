#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从设置各分页的源码生成 src/lib/settings-index.ts。

设置搜索搜的就是这份索引。六十来行标签手抄一遍必然抄错几个，所以先由源码里的
`SettingRow.label` 与其 `hint` 派生出来；生成之后由 `settings-search.test.ts` 再
回扫一遍源码，标签被改名时会失败，而不是留下一条点了跳不到任何地方的搜索结果。

用法：

    python scripts/gen_settings_index.py

改过任何 `src/components/settings/sections/*.tsx` 里的 SettingRow 之后跑一次。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECTIONS = ROOT / "src" / "components" / "settings" / "sections"
TARGET = ROOT / "src" / "lib" / "settings-index.ts"

NAMES = {
    "AppearanceSection.tsx": "appearance",
    "EditorSection.tsx": "editor",
    "CodeSection.tsx": "code",
    "MarkdownSection.tsx": "markdown",
    "ImageSection.tsx": "image",
    "ExportSection.tsx": "export",
    "BehaviorSection.tsx": "behavior",
    "UpdateSection.tsx": "updates",
}

LABEL = re.compile(r'label="([^"]+)"')
HINT = re.compile(r'hint="([^"]+)"')
GROUP = re.compile(r'<SettingGroup title="([^"]+)"')

# 预览框、样例框这类不是设置项，跳过。
SKIP = {"预览"}


def rows() -> list[dict[str, str]]:
    collected: list[dict[str, str]] = []
    for filename, section in NAMES.items():
        text = (SECTIONS / filename).read_text(encoding="utf-8")
        for match in re.finditer(r"<SettingRow\b", text):
            tag = text[match.start() : text.find(">", match.start())]
            label = LABEL.search(tag)
            if not label or label.group(1) in SKIP:
                continue
            hint = HINT.search(tag)
            groups = GROUP.findall(text, 0, match.start())
            collected.append(
                {
                    "section": section,
                    "group": groups[-1] if groups else "",
                    "label": label.group(1),
                    "hint": hint.group(1) if hint else "",
                }
            )
    return collected


def render(entries: list[dict[str, str]]) -> str:
    lines = [
        'import type { SettingsSection } from "@/lib/settings-sections";',
        "",
        "/**",
        " * Every row in the settings, for the search box.",
        " *",
        " * Generated from the section sources — `SettingRow.label` and its `hint` — so the",
        " * labels are the ones actually on screen. A test walks the sources again and fails",
        " * when a label here no longer exists, which is how a rename gets noticed instead of",
        " * producing a search result that jumps nowhere.",
        " *",
        " * `hint` is searched too: people look for 拼写 or 延迟, not for the label above it.",
        " *",
        " * Regenerate with `python scripts/gen_settings_index.py`.",
        " */",
        "export interface SettingsIndexEntry {",
        "  section: SettingsSection;",
        "  /** The group this row sits under, used to name it unambiguously. */",
        "  group: string;",
        "  label: string;",
        "  hint: string;",
        "}",
        "",
        "export const SETTINGS_INDEX: SettingsIndexEntry[] = [",
    ]
    for entry in entries:
        lines.append(
            "  { section: %s, group: %s, label: %s, hint: %s },"
            % (
                json.dumps(entry["section"]),
                json.dumps(entry["group"], ensure_ascii=False),
                json.dumps(entry["label"], ensure_ascii=False),
                json.dumps(entry["hint"], ensure_ascii=False),
            )
        )
    lines += ["];", ""]
    return "\n".join(lines)


def main() -> int:
    entries = rows()
    TARGET.write_text(render(entries), encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(ROOT)} with {len(entries)} rows")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
