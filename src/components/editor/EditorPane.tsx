import { FileSearch, FolderPlus } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";

import { FindBar } from "@/components/editor/FindBar";
import { cn } from "@/lib/cn";
import { fontStack, MONO_FONT_FALLBACK } from "@/lib/fonts";
import { frontMatterKeys, frontMatterValue, parseFrontMatter } from "@/lib/front-matter";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

import { MarkdownEditor } from "./MarkdownEditor";

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted">
      {children}
    </div>
  );
}

/**
 * Raw Markdown view (Typora's 源代码模式).
 *
 * The textarea grows with its content instead of scrolling internally, so the
 * page keeps a single scroll container and switching modes does not jump.
 *
 * The growing is CSS's job (`field-sizing: content`). This used to read
 * `scrollHeight` and write `style.height` on every change, which is a forced
 * synchronous reflow of the whole document per keystroke — the one thing source
 * mode exists to avoid. The measuring fallback below is kept for engines without
 * `field-sizing`, and even then it is coalesced into an animation frame so a
 * burst of input reflows once rather than per character.
 */
const SUPPORTS_FIELD_SIZING =
  typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function SourceEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (SUPPORTS_FIELD_SIZING) return;

    const element = ref.current;
    if (!element) return;

    const frame = requestAnimationFrame(() => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    });

    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <textarea
      ref={ref}
      aria-label="Markdown 源码"
      className="qj-source-editor"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function EditorPane() {
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const content = useWorkspace((state) => state.content);
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const updateContent = useWorkspace((state) => state.updateContent);
  const error = useWorkspace((state) => state.error);
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);

  const isSourceMode = useUi((state) => state.isSourceMode);
  const setFrontMatterOpen = useUi((state) => state.setFrontMatterOpen);

  const fontSize = useSettings((state) => state.settings.fontSize);
  const lineHeight = useSettings((state) => state.settings.lineHeight);
  const editorWidth = useSettings((state) => state.settings.editorWidth);
  const editorFont = useSettings((state) => state.settings.editorFont);
  const codeFont = useSettings((state) => state.settings.codeFont);
  const codeBackground = useSettings((state) => state.settings.codeBackground);
  const codeFontSize = useSettings((state) => state.settings.codeFontSize);
  const imageMaxWidth = useSettings((state) => state.settings.imageMaxWidth);

  if (activeWorkspaceId === null) {
    return (
      <CenteredMessage>
        <FolderPlus className="size-6" />
        <p className="text-sm">还没有打开工作区</p>
        <p className="max-w-sm text-xs">
          点左侧顶部的「打开工作区」选一个本地文件夹，青简会把其中的 Markdown 文件列成文件树
        </p>
      </CenteredMessage>
    );
  }

  if (error) {
    return (
      <CenteredMessage>
        <p className="text-sm text-danger">{error}</p>
      </CenteredMessage>
    );
  }

  if (activeNoteId === null) {
    return (
      <CenteredMessage>
        <FileSearch className="size-6" />
        <p className="text-sm">还没有打开笔记</p>
        <p className="text-xs">在左侧文件树里点一篇，或按 Ctrl + N 新建</p>
      </CenteredMessage>
    );
  }

  if (!contentLoaded) {
    return <CenteredMessage>正在打开…</CenteredMessage>;
  }

  // A long note is handed to the editor whole: the rendering of off-screen
  // blocks is what gets skipped now (see `lib/editor/skip-render`), so there is
  // no longer a size at which the document is demoted to a textarea.
  const showRichText = !isSourceMode;

  // `--crepe-base-font-size` drives every scale step in the editor, so pointing
  // it at the user's font size keeps headings and body text in proportion.
  const columnStyle = {
    maxWidth: editorWidth,
    "--crepe-base-font-size": `${fontSize}px`,
    "--qj-line-height": String(lineHeight),
    "--qj-code-font-size": `${codeFontSize}px`,
    "--qj-image-max-width": `${imageMaxWidth}%`,
    "--qj-editor-font-stack": fontStack(editorFont, "var(--qj-font)"),
    "--qj-code-font-stack": fontStack(codeFont, MONO_FONT_FALLBACK),
  } as CSSProperties;

  // The rich-text surface cannot show the YAML block, so its presence is
  // announced above it with a way into the editor for it.
  const frontMatter = parseFrontMatter(content);
  const metadataKeys = frontMatterKeys(frontMatter.raw);
  const metadataTitle = frontMatterValue(frontMatter.raw, "title");

  return (
    <div className="relative h-full">
      {/* The find bar drives ProseMirror, so it is hidden in source mode. */}
      {showRichText && <FindBar />}
      <div className="editor-scroll">
        <div
          className={cn(
            "editor-column",
            frontMatter.raw && showRichText && "editor-column--meta",
          )}
          data-qj-codebg={codeBackground}
          style={columnStyle}
        >
          {showRichText && frontMatter.raw && (
            <div className="qj-meta-bar">
              <span className="qj-meta-bar__tag">YAML</span>
              <span className="qj-meta-bar__keys" title={metadataKeys.join("、")}>
                {metadataTitle ?? metadataKeys.join(" · ")}
              </span>
              <button
                type="button"
                className="qj-meta-bar__edit"
                onClick={() => setFrontMatterOpen(true)}
              >
                编辑
              </button>
            </div>
          )}
          {showRichText ? (
            <MarkdownEditor key={activeNoteId} noteId={activeNoteId} onChange={updateContent} />
          ) : (
            <SourceEditor value={content} onChange={updateContent} />
          )}
        </div>
      </div>
    </div>
  );
}
