export interface TextSegment {
  /** Text of one document node. */
  text: string;
  /** Document position where `text` starts. */
  start: number;
}

export interface SearchMatch {
  from: number;
  to: number;
}

/**
 * Finds every occurrence of `query`, searching one segment at a time.
 *
 * Segments are searched independently so a match can never straddle two
 * document nodes, which would produce a range that does not cover real text.
 *
 * Case-insensitive matching compares a lower-cased copy. Some scripts change
 * length when lower-cased (for example "İ"), which would shift every offset
 * after it; such a segment falls back to case-sensitive matching instead of
 * reporting ranges that no longer line up with the document.
 */
export function findInSegments(
  segments: readonly TextSegment[],
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  if (query.length === 0) return [];

  const matches: SearchMatch[] = [];

  for (const segment of segments) {
    let haystack = segment.text;
    let needle = query;

    if (!caseSensitive) {
      const lowered = haystack.toLowerCase();
      if (lowered.length === haystack.length) {
        haystack = lowered;
        needle = query.toLowerCase();
      }
    }

    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({
        from: segment.start + index,
        to: segment.start + index + needle.length,
      });
      index = haystack.indexOf(needle, index + needle.length);
    }
  }

  return matches;
}

/** Wraps an index into `[0, count)`, tolerating negative steps. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Whether a match sits comfortably inside its scroll container.
 *
 * The margin keeps the decision from flipping while a smooth scroll is still
 * running, and stops a match that is only just on screen from being called
 * visible — centring it is what the eye expects after a jump.
 */
export function isComfortablyVisible(
  top: number,
  bottom: number,
  boxTop: number,
  boxBottom: number,
  margin: number,
): boolean {
  return top >= boxTop + margin && bottom <= boxBottom - margin;
}

/**
 * The scroll offset that centres a match in its container.
 *
 * `top` is the match's viewport position before scrolling, so the new offset is
 * the current one plus how far the match is below the container's top edge, less
 * half of what is left over once the match itself is accounted for.
 */
export function centredScrollTop(
  scrollTop: number,
  top: number,
  boxTop: number,
  boxHeight: number,
  matchHeight: number,
): number {
  return Math.max(scrollTop + (top - boxTop) - (boxHeight - matchHeight) / 2, 0);
}

/** Whether two ranges share at least one position. */
function overlaps(a: SearchMatch, from: number, to: number): boolean {
  return a.from < to && from < a.to;
}

/**
 * Whether a match lies inside any of the given spans.
 *
 * Used to decide which of the previous matches an edit invalidated: everything
 * inside a re-scanned span is about to be found again, so keeping the old copy
 * would double it.
 */
export function withinAny(match: SearchMatch, spans: readonly SearchMatch[]): boolean {
  return spans.some((span) => overlaps(match, span.from, span.to));
}

/**
 * Merges two already-sorted runs of matches into one document-ordered list.
 *
 * Both inputs come out of a left-to-right scan, so this is a merge rather than a
 * sort — the point of the incremental path is not to touch every match again.
 * Identical ranges collapse, which keeps a span that was both kept and re-scanned
 * from being reported twice.
 */
export function mergeMatches(
  kept: readonly SearchMatch[],
  found: readonly SearchMatch[],
): SearchMatch[] {
  const merged: SearchMatch[] = [];
  let a = 0;
  let b = 0;

  const push = (match: SearchMatch) => {
    const last = merged[merged.length - 1];
    if (last && last.from === match.from && last.to === match.to) return;
    merged.push(match);
  };

  while (a < kept.length && b < found.length) {
    if (kept[a].from <= found[b].from) push(kept[a++]);
    else push(found[b++]);
  }
  while (a < kept.length) push(kept[a++]);
  while (b < found.length) push(found[b++]);

  return merged;
}

/**
 * The index of the match at `from`, or the nearest one after it.
 *
 * After an edit the highlighted match may be gone; the eye expects the next one
 * down the document rather than a jump back to the top, so the search is for the
 * first match that starts at or after where the current one used to be.
 */
export function indexAtOrAfter(matches: readonly SearchMatch[], from: number): number {
  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index].from >= from) return index;
  }
  return 0;
}
