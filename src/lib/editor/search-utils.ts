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
