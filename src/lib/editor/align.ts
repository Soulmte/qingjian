/**
 * Shared left / centre / right alignment, for both blocks of text and images.
 *
 * Markdown has no alignment syntax, so each representation is chosen by what the
 * surrounding node already round-trips:
 *
 * - a paragraph or heading is turned into a **marker comment on the preceding
 *   line**, which `remark` reads back as an `html` node and the parser folds into
 *   the block's `align` attribute. The marker never reaches the document, so the
 *   editor has nothing extra to render;
 * - an image rides in its **URL fragment** (`a.png#qj-align=left`), because
 *   Crepe's image node copies `src` verbatim in both directions — see
 *   `image-align.ts`.
 *
 * `"left"` is the default everywhere: it is what plain Markdown means, so an
 * untouched document keeps producing byte-identical Markdown.
 */
export type Align = "left" | "center" | "right";

/** Class the decoration plugin puts on an aligned block. */
export function alignClass(align: Align): string {
  return `qj-align--${align}`;
}

export function isAlign(value: unknown): value is Align {
  return value === "left" || value === "center" || value === "right";
}

const MARKER = /^<!--\s*qj-align:(left|center|right)\s*-->$/;

/** The alignment a marker line stands for, or `null` when it is not one. */
export function parseAlignMarker(value: unknown): Align | null {
  if (typeof value !== "string") return null;
  const match = MARKER.exec(value.trim());
  return match ? (match[1] as Align) : null;
}

/** The comment line written before a block that is not left-aligned. */
export function alignMarker(align: Align): string {
  return `<!-- qj-align:${align} -->`;
}

/** The little of mdast this module needs to touch. */
export interface MarkerNode {
  type: string;
  value?: string;
  children?: MarkerNode[];
  /** Set by [`applyAlignMarkers`] and read by the paragraph / heading parser. */
  qjAlign?: Align;
}

/**
 * Folds marker comments into the block they describe.
 *
 * A marker is removed from the tree once its alignment has been recorded, so the
 * editor sees a plain paragraph rather than an HTML node the user would have to
 * scroll past. Walking backwards keeps the indices valid while splicing.
 */
export function applyAlignMarkers(parent: MarkerNode): void {
  const children = parent.children;
  if (!Array.isArray(children)) return;

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const node = children[index];
    if (node.type !== "html") {
      applyAlignMarkers(node);
      continue;
    }

    const align = parseAlignMarker(node.value);
    const next = children[index + 1];
    // A trailing marker describes nothing, so it is left alone rather than
    // silently throwing the user's intent away.
    if (!align || !next) continue;

    next.qjAlign = align;
    children.splice(index, 1);
  }
}
