/**
 * Which part of the document a transaction actually touched.
 *
 * The decoration plugins used to rebuild themselves from the whole document on
 * every keystroke: `doc.descendants(…)` over every node, a `Decoration` object
 * per block, and a fresh `DecorationSet` to sort them all. On a note of a few
 * hundred thousand characters that is thousands of allocations per character
 * typed, and it is the reason the rich surface felt sticky long before the
 * browser's own rendering did.
 *
 * A transaction knows what it changed, so the work can be made proportional to
 * the edit instead: map the existing decorations through it, then rebuild only
 * the blocks the edit fell inside.
 */

import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
export interface DocRange {
  from: number;
  to: number;
}

/** Builds the decorations for one span of the document. */
export type RangeBuilder = (doc: ProseNode, from: number, to: number) => Decoration[];

/**
 * The spans of the *new* document that `tr` rewrote.
 *
 * Each step map reports positions in the document as it stood right after that
 * step, so the remaining steps have to be applied before the numbers refer to
 * the document the plugin is now looking at — hence the `slice(index + 1)`.
 */
export function changedRanges(tr: Transaction): DocRange[] {
  const ranges: DocRange[] = [];

  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => {
      // Biased outwards so an insertion at a boundary still counts as touching
      // the block on either side of it.
      ranges.push({ from: rest.map(from, -1), to: rest.map(to, 1) });
    });
  });

  return mergeRanges(ranges);
}

/** Sorts and coalesces overlapping or abutting ranges. */
export function mergeRanges(ranges: readonly DocRange[]): DocRange[] {
  if (ranges.length < 2) return ranges.slice();

  const sorted = ranges.slice().sort((a, b) => a.from - b.from);
  const merged: DocRange[] = [sorted[0]];

  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }

  return merged;
}

/**
 * Widens a range to the top-level blocks it falls inside.
 *
 * A node decoration covers a whole block, so rebuilding half of one would
 * produce a range that does not line up with a node and gets dropped.
 *
 * An empty range sitting *between* two blocks is widened to the block that
 * starts there. Such a range names a boundary rather than a block, and left
 * alone it would rebuild nothing at all — which is how the block a caret had
 * just left kept its active class in focus mode.
 */
export function blockRange(doc: ProseNode, range: DocRange): DocRange {
  const limit = doc.content.size;
  const from = Math.max(0, Math.min(range.from, limit));
  const to = Math.max(from, Math.min(range.to, limit));

  const $from = doc.resolve(from);
  const $to = doc.resolve(to);

  const start = $from.depth === 0 ? from : $from.before(1);
  let end = $to.depth === 0 ? to : $to.after(1);

  if (start === end) {
    const next = doc.resolve(start).nodeAfter;
    if (next) end = start + next.nodeSize;
  }

  return { from: start, to: end };
}

/**
 * The decorations in `set` that genuinely overlap `[from, to]`.
 *
 * `DecorationSet.find` also reports decorations that merely *touch* the range,
 * so querying the span of one block comes back with its neighbours on either
 * side as well — and rebuilding those defeats the point of working incrementally.
 * A shared endpoint is not an overlap, so those are dropped here.
 */
function overlapping(set: DecorationSet, from: number, to: number): Decoration[] {
  return set.find(from, to).filter((d) => d.from < to && from < d.to);
}

/**
 * Rebuilds the decorations covering the given spans, leaving the rest in place.
 *
 * Every span is first widened to whole blocks and only then coalesced. The order
 * matters: an empty span naming a block boundary would otherwise be swallowed by
 * the range ending there and never widened, which is how the block a caret had
 * just left kept its active class.
 *
 * Each span is then widened once more, past every decoration that overlaps it — a
 * mapped decoration can reach outside the span, and dropping one without building
 * it again would lose its class.
 */
export function rebuildRanges(
  set: DecorationSet,
  doc: ProseNode,
  ranges: readonly DocRange[],
  build: RangeBuilder,
): DecorationSet {
  let next = set;

  for (const range of mergeRanges(ranges.map((range) => blockRange(doc, range)))) {
    const stale = overlapping(next, range.from, range.to);

    let from = range.from;
    let to = range.to;
    for (const decoration of stale) {
      from = Math.min(from, decoration.from);
      to = Math.max(to, decoration.to);
    }

    if (stale.length > 0) next = next.remove(stale);
    next = next.add(doc, build(doc, from, to));
  }

  return next;
}

/**
 * Carries a set of node decorations across a transaction, rebuilding only the
 * blocks it touched.
 */
export function syncDecorations(
  previous: DecorationSet,
  tr: Transaction,
  doc: ProseNode,
  build: RangeBuilder,
): DecorationSet {
  return rebuildRanges(previous.map(tr.mapping, doc), doc, changedRanges(tr), build);
}

/**
 * Runs `visit` for every top-level block that overlaps `[from, to]`.
 *
 * `nodesBetween` would descend into each block as well; the decoration builders
 * only ever tag the block itself, so the children are pure overhead. Iterating
 * the document's own children stops at the depth that matters.
 */
export function forEachBlockIn(
  doc: ProseNode,
  from: number,
  to: number,
  visit: (node: ProseNode, pos: number) => void,
): void {
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    const end = pos + child.nodeSize;
    // The list is in document order, so everything left is past the range.
    if (pos >= to) break;
    if (end > from) visit(child, pos);
    pos = end;
  }
}
