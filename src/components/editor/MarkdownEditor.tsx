import { editorViewCtx } from "@milkdown/kit/core";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import type { EditorView } from "@milkdown/kit/prose/view";
import { insert } from "@milkdown/kit/utils";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import "@milkdown/crepe/theme/common/style.css";
import { useEffect, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { codeThemeExtension } from "@/lib/code-theme";
import {
  detectClipboardImage,
  imageFileName,
  resolveClipboardImage,
  sourceHint,
  type ClipboardImagePlan,
} from "@/lib/clipboard-image";
import { alignPlugin, alignedHeadingSchema, alignedParagraphSchema, remarkBlockAlignPlugin } from "@/lib/editor/align-plugin";
import { alignmentForUi } from "@/lib/editor/align-selection";
import {
  consumePlainPaste,
  notifyEditorChanged,
  setActiveEditor,
  setActiveEditorView,
  setMarkdownInserter,
  subscribeEditor,
} from "@/lib/editor/bridge";
import { buildEditorMenu } from "@/lib/editor/editor-menu";
import { focusModePlugin } from "@/lib/editor/focus-mode";
import { normaliseTableBreaks } from "@/lib/editor/table-markdown";
import { parseFrontMatter, withFrontMatter } from "@/lib/front-matter";
import { EDITOR_PLACEHOLDER, editorLabels } from "@/lib/editor/locale";
import { searchPlugin } from "@/lib/editor/search";
import { skipRenderPlugin } from "@/lib/editor/skip-render";
import { resolveImageSrc, storeImage } from "@/lib/images";
import { isLargeDocument } from "@/lib/large-document";
import { centerCaret } from "@/lib/editor/typewriter";
import { typoraKeymap } from "@/lib/typora-keymap";
import { useContextMenu } from "@/lib/context-menu";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { AppSettings } from "@/types";

interface MarkdownEditorProps {
  /** Documents are keyed by note id, so this changing means a fresh instance. */
  noteId: number;
  onChange: (markdown: string) => void;
}

/** Crepe features that the Markdown settings page can switch off. */
function buildFeatures(settings: AppSettings) {
  return {
    [CrepeFeature.AI]: false,
    [CrepeFeature.TopBar]: false,
    [CrepeFeature.Latex]: settings.mathEnabled,
    [CrepeFeature.Table]: settings.tableEnabled,
    [CrepeFeature.CodeMirror]: settings.codeHighlightEnabled,
    [CrepeFeature.LinkTooltip]: settings.linkTooltipEnabled,
    [CrepeFeature.BlockEdit]: settings.blockHandleEnabled,
  };
}

/**
 * Whether a drag is carrying files at all. During `dragover` the `files` list
 * is still empty — only `types` reveals the payload — so the drop target has to
 * be opted in based on this.
 */
function dragCarriesFiles(data: DataTransfer | null): boolean {
  return data !== null && Array.from(data.types).includes("Files");
}

/**
 * Typora-style WYSIWYG surface backed by Milkdown Crepe.
 *
 * The instance is created once per note and destroyed on the way out. Reusing
 * one instance across documents would carry ProseMirror's undo history and
 * selection along with it, which is how formats get lost.
 */
export function MarkdownEditor({ noteId, onChange }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const spellCheck = useSettings((state) => state.settings.spellCheck);
  const focusMode = useSettings((state) => state.settings.focusMode);
  const typewriterMode = useSettings((state) => state.settings.typewriterMode);

  /**
   * Settings baked into the editor instance at construction time. Settings open
   * as a dialog, so the editor stays mounted while they change; this key is what
   * forces a rebuild with the new configuration.
   */
  const editorConfigKey = useSettings((state) =>
    [
      state.settings.codeBackground,
      state.settings.mathEnabled,
      state.settings.tableEnabled,
      state.settings.codeHighlightEnabled,
      state.settings.linkTooltipEnabled,
      state.settings.blockHandleEnabled,
    ].join("|"),
  );

  /**
   * Bumped when the buffer was replaced from disk instead of typed.
   *
   * Part of the rebuild key for the same reason as `editorConfigKey`: Crepe reads
   * its text once, at construction, so a reload only reaches the screen through a
   * new instance.
   */
  const contentEpoch = useWorkspace((state) => state.contentEpoch);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const settings = useSettings.getState().settings;
    // Read at build time: on a rebuild the store already holds the live buffer.
    // The YAML block is withheld from the editor, which would otherwise read its
    // delimiters as a rule and its keys as a heading.
    const initialContent = parseFrontMatter(useWorkspace.getState().content).body;
    let disposed = false;
    /**
     * The last document this instance reported, seeded with what it was built
     * from.
     *
     * A rebuild — which is how a reload from disk reaches the screen — re-emits
     * the text it was just built with. Pushing that back would mark the note dirty
     * and write the user's file again, in our serialisation, moments after they
     * saved it in another editor. Nothing is lost by ignoring it: the store holds
     * that exact text already, and any real edit changes it.
     */
    let lastMarkdown = initialContent;

    const scroller = host.closest(".editor-scroll");

    // A reload from disk rebuilds this editor (see `contentEpoch`). The host is
    // empty while that happens, and the scroll container answers an empty
    // document by clamping its position to the top — so the reader's place is
    // taken now and put back once the text is in. Coming back to the app after
    // editing the file elsewhere should not also lose where you were.
    const keepScroll = scroller instanceof HTMLElement ? scroller.scrollTop : 0;

    const centerIfTypewriter = (immediate = false) => {
      if (!useSettings.getState().settings.typewriterMode) return;
      const view = viewRef.current;
      if (view && scroller instanceof HTMLElement) centerCaret(view, scroller, immediate);
    };

    const crepe = new Crepe({
      root: host,
      defaultValue: initialContent,
      features: buildFeatures(settings),
      featureConfigs: {
        ...editorLabels,
        [CrepeFeature.Placeholder]: { text: EDITOR_PLACEHOLDER },
        // Supplying a CodeMirror config replaces Crepe's whole extension list,
        // so the theme (and therefore the syntax palette) must be explicit.
        [CrepeFeature.CodeMirror]: {
          ...editorLabels[CrepeFeature.CodeMirror],
          theme: codeThemeExtension(settings.codeBackground),
        },
        // Notes store workspace-relative image paths; the asset URL is built
        // only for rendering, so the Markdown stays portable.
        [CrepeFeature.ImageBlock]: { proxyDomURL: resolveImageSrc },
      },
    });

    crepe.editor
      // Serialising back is not byte-for-byte, and the default shows it: every `-`
      // bullet comes back as `*`, so a note edited here and then opened anywhere
      // else looks rewritten. Pinned back to the character people type.
      .config((ctx) => {
        ctx.update(remarkStringifyOptionsCtx, (options) => ({
          ...options,
          bullet: "-" as const,
        }));

        // Table layout is a `remark-gfm` option, not a stringify one, because the
        // serializer only pads a column when `remark-gfm` handed it the extension
        // configured that way — setting it on the stringify options is silently
        // ignored (which is why the old `tablePipeAlign: false` there did
        // nothing). Off, a row reads `| 甲 | 短 |` instead of being stretched to
        // the widest cell in its column, and the delimiter row collapses to
        // `| - |`. Cell padding stays on so each cell keeps its single space.
        ctx.update(remarkGFMPlugin.options.key, () => ({
          tablePipeAlign: false,
          tableCellPadding: true,
        }));
      })
      // Typora-compatible chords, in addition to the presets' own bindings.
      .use(typoraKeymap.ctx)
      .use(typoraKeymap.shortcuts)
      .use(focusModePlugin)
      .use(alignPlugin)
      // Paragraph and heading are re-registered with an `align` attribute.
      // Milkdown's `$node` upserts by id, so these replace the preset's own.
      // The whole tuple is used, not just `.node`: the node plugin reads the
      // schema factory out of its own `$ctx`, and injecting only the node
      // leaves that slice missing — `create()` then rejects.
      .use(alignedParagraphSchema)
      .use(alignedHeadingSchema)
      .use(remarkBlockAlignPlugin)
      .use(searchPlugin);

    // Only long notes get it: containment makes each block lay out on its own
    // and the scrollbar ride on estimates until a block has been seen, neither
    // of which is worth paying for on a note that renders instantly anyway.
    if (isLargeDocument(initialContent)) crepe.editor.use(skipRenderPlugin);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (disposed) return;
        if (markdown === lastMarkdown) return;
        lastMarkdown = markdown;

        // The block is re-read rather than captured: the metadata dialog can
        // replace it while this editor instance stays mounted.
        const { raw } = parseFrontMatter(useWorkspace.getState().content);
        onChangeRef.current(withFrontMatter(raw, normaliseTableBreaks(markdown)));
      });

      listener.mounted(() => notifyEditorChanged());

      listener.updated(() => {
        if (!disposed) notifyEditorChanged();
      });

      listener.selectionUpdated(() => {
        if (disposed) return;
        notifyEditorChanged();
        centerIfTypewriter();
      });
    });

    const ready = crepe.create();

    // A rejected `create` leaves a half-mounted editor: the view renders, but
    // `editorViewCtx` is never reachable, so every feature that goes through the
    // bridge silently stops working. Surfacing it beats debugging a toolbar that
    // merely looks greyed out.
    void ready.catch((error) => {
      if (!disposed) setNotice(`编辑器初始化失败：${errorMessage(error)}`);
    });

    void ready.then(() => {
      if (disposed) return;

      crepe.editor.action((ctx) => {
        viewRef.current = ctx.get(editorViewCtx);
      });
      setActiveEditorView(viewRef.current);
      setActiveEditor(crepe.editor);
      // Toolbar buttons and app-level shortcuts insert through this, so the
      // markdown goes through Crepe's parser rather than a hand-built node.
      setMarkdownInserter((markdown) => crepe.editor.action(insert(markdown)));

      // `mounted` can fire before the panels that watch the editor have
      // subscribed, so announce the view once more: without this the alignment
      // buttons stay disabled until an unrelated edit happens to poke them.
      notifyEditorChanged();

      // ProseMirror ignores a `spellcheck` attribute on an ancestor, so it is
      // set on the editable element itself.
      host
        .querySelector(".ProseMirror")
        ?.setAttribute("spellcheck", String(settings.spellCheck));

      centerIfTypewriter(true);

      if (keepScroll > 0 && scroller instanceof HTMLElement) {
        // Two frames: Crepe's mount is asynchronous, and the document has to have
        // its height back before the position can be restored.
        requestAnimationFrame(() => {
          if (disposed) return;
          requestAnimationFrame(() => {
            if (!disposed) scroller.scrollTop = keepScroll;
          });
        });
      }
    });

    /** Writes the image into the workspace and optionally references it. */
    const acceptImage = async (plan: ClipboardImagePlan) => {
      const { imageAutoInsert } = useSettings.getState().settings;

      try {
        const resolved = await resolveClipboardImage(plan, api.fetchImageSource);
        const hint =
          plan.kind === "file"
            ? plan.file.name
            : plan.kind === "source"
              ? sourceHint(plan.source)
              : undefined;
        const stored = await storeImage(imageFileName(resolved.mime, hint), resolved.bytes);

        if (imageAutoInsert) {
          crepe.editor.action(insert(stored.markdown));
        } else {
          setNotice(
            stored.location === "git"
              ? `已上传图床：${stored.reference}`
              : `图片已保存：${stored.reference}`,
          );
        }
      } catch (error) {
        setNotice(`图片保存失败：${errorMessage(error)}`);
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      // `Ctrl+Shift+V` wins over everything: the user explicitly asked for the
      // text half, so an image on the clipboard must not take precedence.
      if (consumePlainPaste()) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const view = viewRef.current;
        if (text && view) {
          event.preventDefault();
          event.stopPropagation();
          view.pasteText(text);
          return;
        }
      }

      const plan = detectClipboardImage(event.clipboardData);
      if (!plan) return;

      // Capture phase: stop ProseMirror from also treating this as text input.
      event.preventDefault();
      event.stopPropagation();
      void acceptImage(plan);
    };

    const onDrop = (event: DragEvent) => {
      // Any file drop is claimed, image or not: letting the webview handle a
      // non-image would navigate away from the document.
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();

      const plan = detectClipboardImage(event.dataTransfer);
      if (plan) {
        void acceptImage(plan);
      } else {
        setNotice("只支持拖入图片文件");
      }
    };

    const onDragOver = (event: DragEvent) => {
      if (dragCarriesFiles(event.dataTransfer)) event.preventDefault();
    };

    /** Replaces the webview's own menu with the app's. */
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;
      useContextMenu.getState().openAt(event.clientX, event.clientY, buildEditorMenu(view));
    };

    host.addEventListener("paste", onPaste, true);
    host.addEventListener("drop", onDrop, true);
    host.addEventListener("dragover", onDragOver, true);
    host.addEventListener("contextmenu", onContextMenu);

    return () => {
      disposed = true;
      setActiveEditorView(null);
      setActiveEditor(null);
      setMarkdownInserter(null);
      viewRef.current = null;
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("drop", onDrop, true);
      host.removeEventListener("dragover", onDragOver, true);
      host.removeEventListener("contextmenu", onContextMenu);
      // Destroying before `create` settles throws; wait for it first.
      void ready.then(() => crepe.destroy()).catch(() => undefined);
    };
  }, [noteId, editorConfigKey, contentEpoch]);

  // Toggling these does not require rebuilding the editor.
  useEffect(() => {
    hostRef.current
      ?.querySelector(".ProseMirror")
      ?.setAttribute("spellcheck", String(spellCheck));
  }, [spellCheck, editorConfigKey]);

  useEffect(() => {
    if (!typewriterMode) return;
    const view = viewRef.current;
    const scroller = hostRef.current?.closest(".editor-scroll");
    if (view && scroller instanceof HTMLElement) centerCaret(view, scroller, true);
  }, [typewriterMode]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Tell the top bar which side the block under the caret is on, so its
  // alignment group can mark the active button. The editor fires this on every
  // document/selection change, which covers moving the caret, clicking an image,
  // and the alignment itself being applied.
  useEffect(() => {
    const sync = () => {
      const view = viewRef.current;
      useUi.getState().setBlockAlign(view ? alignmentForUi(view.state) : null);
    };

    const unsubscribe = subscribeEditor(sync);
    sync();

    return () => {
      unsubscribe();
      useUi.getState().setBlockAlign(null);
    };
  }, [noteId]);

  return (
    <div className="relative">
      {notice && (
        <p
          role="status"
          className="absolute top-3 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-lg border border-border/70 px-3 py-1.5 text-xs shadow-sm"
          style={{ background: "var(--qj-bg-paper)", color: "var(--qj-text)" }}
        >
          {notice}
        </p>
      )}
      <div
        className={cn("milkdown-host", focusMode && "qj-focus-mode")}
        ref={hostRef}
      />
    </div>
  );
}
