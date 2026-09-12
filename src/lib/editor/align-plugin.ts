import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { headingSchema, paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { $prose, $remark } from "@milkdown/kit/utils";

import {
  alignClass,
  alignMarker,
  applyAlignMarkers,
  isAlign,
  type Align,
  type MarkerNode,
} from "./align";
import { alignOfNode } from "./align-selection";
import { forEachBlockIn, syncDecorations } from "./changed-ranges";

const ALIGN_ATTR = { default: "left", validate: "string" };

/* -------------------------------------------------------------------------- */
/* Markdown: a marker comment on the line above the block                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads markers back into the block they describe.
 *
 * The marker is removed from the tree, so the editor never renders the comment
 * as an HTML node the user would have to step over — the alignment survives
 * purely as a node attribute from here on.
 */
export const remarkBlockAlignPlugin = $remark(
  "qj-block-align",
  () => () => (tree: MarkerNode) => {
    applyAlignMarkers(tree);
  },
);

function alignFrom(node: MarkerNode): Align {
  return isAlign(node.qjAlign) ? node.qjAlign : "left";
}

/** The marker a block needs before itself, or `null` for the default. */
function markerFor(align: unknown): string | null {
  return isAlign(align) && align !== "left" ? alignMarker(align) : null;
}

/* -------------------------------------------------------------------------- */
/* Schema: an `align` attribute on paragraphs and headings                     */
/* -------------------------------------------------------------------------- */

/**
 * Paragraphs and headings gain one attribute.
 *
 * `extendSchema` returns a schema registered under the same node id, and
 * Milkdown's `$node` upserts into the node table, so using the result in place
 * of the preset's own plugin is the supported way to add a field — no fork, and
 * every existing command keeps working because the content expression is
 * unchanged.
 */
export const alignedParagraphSchema = paragraphSchema.extendSchema(
  (prev) => (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      attrs: { ...base.attrs, align: ALIGN_ATTR },
      parseMarkdown: {
        match: base.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, { align: alignFrom(node as MarkerNode) });
          if (node.children) state.next(node.children);
          else state.addText((node.value || "") as string);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: base.toMarkdown.match,
        runner: (state, node) => {
          const marker = markerFor(node.attrs.align);
          if (marker) state.addNode("html", undefined, marker);
          base.toMarkdown.runner(state, node);
        },
      },
    };
  },
);

export const alignedHeadingSchema = headingSchema.extendSchema(
  (prev) => (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      attrs: { ...base.attrs, align: ALIGN_ATTR },
      parseMarkdown: {
        match: base.parseMarkdown.match,
        runner: (state, node, type) => {
          const depth = node.depth as number;
          state.openNode(type, { level: depth, align: alignFrom(node as MarkerNode) });
          state.next(node.children);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: base.toMarkdown.match,
        runner: (state, node) => {
          const marker = markerFor(node.attrs.align);
          if (marker) state.addNode("html", undefined, marker);
          base.toMarkdown.runner(state, node);
        },
      },
    };
  },
);

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

export const alignKey = new PluginKey<DecorationSet>("qjAlign");

/**
 * Tags every alignable block with its side.
 *
 * Placement lives in an attribute (text) or in the URL (images), neither of
 * which the view renders on its own, so the class is what the stylesheet turns
 * into a layout. Node decorations on a custom node view's `dom` are already used
 * by focus mode, so this works for Crepe's image block as well.
 *
 * Only top-level blocks are looked at: `alignOfNode` answers for paragraphs,
 * headings and image blocks, and a paragraph nested in a list or a quote is
 * deliberately not alignable (see `align-selection.ts`), so descending into
 * children only ever produced decorations that were thrown away.
 */
export function alignDecorationsIn(doc: ProseNode, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = [];

  forEachBlockIn(doc, from, to, (node, pos) => {
    const align = alignOfNode(node);
    if (align) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { class: alignClass(align) }),
      );
    }
  });

  return decorations;
}

export function buildAlignDecorations(state: EditorState): DecorationSet {
  return DecorationSet.create(
    state.doc,
    alignDecorationsIn(state.doc, 0, state.doc.content.size),
  );
}

export const alignPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: alignKey,
      state: {
        init: (_config, state) => buildAlignDecorations(state),
        // Only the blocks the edit fell inside are rebuilt; the rest are carried
        // across by `map`. Rebuilding the whole document here meant a pass over
        // every block, and a fresh decoration for each, on every keystroke.
        apply: (tr, value, _oldState, newState) =>
          tr.docChanged
            ? syncDecorations(value, tr, newState.doc, alignDecorationsIn)
            : value,
      },
      props: {
        decorations: (state) => alignKey.getState(state) ?? null,
      },
      /**
       * Pins each caption to its image's width.
       *
       * The caption is a sibling of the image wrapper, not a child, so CSS alone
       * cannot know how wide the image rendered — and a `width: 100%` caption
       * would stretch across the whole column, leaving a right-aligned figure
       * with its description stranded at the far edge. The measured width is
       * published as `--qj-caption-w`, which the stylesheet consumes; observing
       * instead of measuring on every keystroke keeps typing off the layout path.
       */
      view: (editorView) => {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const image = entry.target as HTMLImageElement;
            const block = image.closest<HTMLElement>(".milkdown-image-block");
            const width = entry.contentRect.width;
            if (block && width > 0) {
              block.style.setProperty("--qj-caption-w", `${Math.round(width)}px`);
            }
          }
        });

        const observe = () => {
          editorView.dom
            .querySelectorAll<HTMLImageElement>(".image-wrapper > img")
            .forEach((image) => observer.observe(image));
        };
        observe();

        return {
          update: observe,
          destroy: () => observer.disconnect(),
        };
      },
    }),
);
