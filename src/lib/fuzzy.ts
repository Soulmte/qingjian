/** Characters that mark the start of a new word in identifiers and paths. */
const WORD_BOUNDARY = /[\s\-_/.]/;

/**
 * Scores `query` as a subsequence of `text`, or returns `null` when it does not
 * match at all.
 *
 * Consecutive characters and matches at a word start score higher, and shorter
 * candidates get a nudge up, which is the behaviour people expect from a fuzzy
 * finder: typing "查" should surface "查找" before "查找并替换全部内容".
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (query.length === 0) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let score = 0;
  let cursor = 0;
  let previous = -1;

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;

    score += 1;
    // `previous` starts at -1, so the boundary check keeps a leading match at
    // index 0 from being mistaken for a consecutive one.
    if (previous >= 0 && found === previous + 1) score += 3;
    if (found === 0 || WORD_BOUNDARY.test(haystack[found - 1] ?? "")) score += 2;

    previous = found;
    cursor = found + 1;
  }

  // Nudge shorter candidates up so "查找" beats "查找并替换全部内容". A coarser
  // divisor ties short Chinese labels together and the ranking does nothing.
  score -= Math.floor(haystack.length / 8);
  return score;
}

/** Ranks `items` best-first, dropping anything the query does not match. */
export function rankByFuzzy<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const score = fuzzyScore(text(item), query);
    if (score !== null) scored.push({ item, score });
  }

  // Stable ordering keeps the declaration order for equally good matches.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}
