import { SETTINGS_INDEX, type SettingsIndexEntry } from "@/lib/settings-index";
import { SECTION_TITLES } from "@/lib/settings-sections";

/**
 * Searching the settings.
 *
 * Sixty rows across ten pages is past the point where scrolling is a strategy, so
 * the rail gets a search box. What is searched is what is written on the row — the
 * label, its group and its hint — plus the name of the page it lives on, because
 * 「导出」 is a perfectly good way to ask for everything on that page.
 */

/** How many results are worth showing before the rail is all results. */
const LIMIT = 12;

/** What a row can be matched against, lower-cased once. */
function haystack(entry: SettingsIndexEntry): string {
  return `${entry.label} ${entry.group} ${entry.hint} ${SECTION_TITLES[entry.section]}`.toLowerCase();
}

/**
 * Scores one entry against the words typed.
 *
 * Every word has to appear (so 「导出 字号」 narrows rather than widens), and where
 * it appears decides the order: a label beats a group, which beats a hint. Without
 * that, typing 「字体」 would surface rows that merely mention the word.
 */
function score(entry: SettingsIndexEntry, words: string[]): number {
  const label = entry.label.toLowerCase();
  const group = entry.group.toLowerCase();
  const rest = haystack(entry);
  let total = 0;

  for (const word of words) {
    if (label.startsWith(word)) total += 4;
    else if (label.includes(word)) total += 3;
    else if (group.includes(word)) total += 2;
    else if (rest.includes(word)) total += 1;
    else return -1;
  }

  return total;
}

/** The rows matching `query`, best first. */
export function searchSettings(query: string): SettingsIndexEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  return SETTINGS_INDEX.map((entry, index) => ({ entry, index, score: score(entry, words) }))
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, LIMIT)
    .map((hit) => hit.entry);
}

/** Where a result should take the user: 「行高 · 排版 · 编辑器」. */
export function describeResult(entry: SettingsIndexEntry): string {
  return [entry.group, SECTION_TITLES[entry.section]].filter(Boolean).join(" · ");
}
