import { useEffect, useRef, type CSSProperties } from "react";

import { FindBar } from "@/components/editor/FindBar";
import { QingjianMark } from "@/components/ui/QingjianMark";
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
 */
function SourceEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
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
        <QingjianMark size={64} className="mb-1 opacity-80" />
        <p className="text-sm">还没有打开工作区</p>
        <p className="text-xs">在左侧选择一个本地文件夹，即可开始书写</p>
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
        <QingjianMark size={64} className="mb-1 opacity-80" />
        <p className="text-sm">选择一篇笔记，或新建一篇</p>
      </CenteredMessage>
    );
  }

  if (!contentLoaded) {
    return <CenteredMessage>正在打开…</CenteredMessage>;
  }

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
      {!isSourceMode && <FindBar />}
      <div className="editor-scroll">
        <div
          className={cn(
            "editor-column",
            frontMatter.raw && !isSourceMode && "editor-column--meta",
          )}
          data-qj-codebg={codeBackground}
          style={columnStyle}
        >
          {!isSourceMode && frontMatter.raw && (
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
          {isSourceMode ? (
            <SourceEditor value={content} onChange={updateContent} />
          ) : (
            <MarkdownEditor key={activeNoteId} noteId={activeNoteId} onChange={updateContent} />
          )}
        </div>
      </div>
    </div>
  );
}
