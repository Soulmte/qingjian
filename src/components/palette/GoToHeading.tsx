import { Modal } from "@heroui/react";
import { TextSelection } from "@milkdown/kit/prose/state";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { getActiveEditorView } from "@/lib/editor/bridge";
import { rankByFuzzy } from "@/lib/fuzzy";
import { parseOutline, type OutlineItem } from "@/lib/markdown";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

const HEADING_SELECTOR = ".milkdown .ProseMirror :is(h1,h2,h3,h4,h5,h6)";

/**
 * The headings as they are rendered.
 *
 * `parseOutline` reads the Markdown and this reads the editor, and they agree
 * because the editor is built from the same document — which is also why an
 * index from one can address the other, and why the outline panel works the same
 * way. Matching on the text instead would break the moment two headings repeat.
 */
function renderedHeadings(): HTMLElement[] {
  const scroller = document.querySelector(".editor-scroll");
  if (!scroller) return [];
  return Array.from(scroller.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
}

/** Scrolls the nth heading into view and puts the caret at its start. */
function jumpToHeading(index: number): void {
  const target = renderedHeadings()[index];
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "start" });

  const view = getActiveEditorView();
  if (!view) return;
  try {
    const position = view.posAtDOM(target, 0);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))),
    );
    view.focus();
  } catch {
    // The heading is not part of the editor's document — scrolling is enough.
  }
}

/** Selects a 1-based line in the source-mode textarea. */
function jumpToLine(line: number): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(".qj-source-editor");
  if (!textarea) return;

  const lines = textarea.value.split("\n");
  const target = Math.min(Math.max(line, 1), Math.max(lines.length, 1));
  let offset = 0;
  for (let index = 0; index < target - 1; index += 1) offset += lines[index].length + 1;

  textarea.focus();
  textarea.setSelectionRange(offset, offset + (lines[target - 1]?.length ?? 0));

  const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24;
  const scroller = textarea.closest(".editor-scroll");
  if (scroller) scroller.scrollTop = (target - 1) * lineHeight;
}

/**
 * Typora's 跳到标题, plus a line jump where lines exist.
 *
 * The outline panel is the same journey with the mouse; this is the keyboard
 * one, and the only way to reach a heading in a long document without scrolling.
 */
export function GoToHeading() {
  const isOpen = useUi((state) => state.isGoToOpen);
  const setOpen = useUi((state) => state.setGoToOpen);
  const isSourceMode = useUi((state) => state.isSourceMode);

  const content = useWorkspace((state) => state.content);
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const headings = useMemo(
    () => (contentLoaded ? parseOutline(content) : []),
    [content, contentLoaded],
  );

  /** The line the query names, when it names one and there are lines to name. */
  const lineNumber = useMemo(() => {
    if (!isSourceMode) return null;
    const trimmed = query.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number.parseInt(trimmed, 10);
    return value > 0 ? value : null;
  }, [isSourceMode, query]);

  const results = useMemo(() => {
    if (!query.trim()) return headings;
    return rankByFuzzy(headings, query, (item: OutlineItem) => item.text);
  }, [headings, query]);

  // Rows are the line jump first, when there is one, then the headings.
  const rows = useMemo(() => {
    const headingRows = results.map((item, index) => ({
      kind: "heading" as const,
      item,
      /** Index into the rendered headings, not into the filtered list. */
      headingIndex: headings.indexOf(item),
      key: `h-${item.line}-${index}`,
    }));
    return lineNumber === null
      ? headingRows
      : [
          { kind: "line" as const, line: lineNumber, key: `l-${lineNumber}` },
          ...headingRows,
        ];
  }, [headings, lineNumber, results]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const choose = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setOpen(false);
    if (row.kind === "line") jumpToLine(row.line);
    else jumpToHeading(row.headingIndex);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen} variant="blur">
      <Modal.Container size="lg" placement="top">
        <Modal.Dialog className="qj-palette" aria-label="跳转">
          <div className="border-b border-border/60 p-2">
            <input
              autoFocus
              className="field w-full"
              placeholder={isSourceMode ? "输入标题，或行号…" : "输入标题…"}
              aria-label="跳转到标题"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, rows.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(activeIndex);
                }
              }}
            />
          </div>

          <ul
            ref={listRef}
            role="listbox"
            aria-label="可跳转的位置"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    index === activeIndex
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "hover:bg-default/60",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                >
                  {row.kind === "line" ? (
                    <span className="min-w-0 flex-1 truncate">转到第 {row.line} 行</span>
                  ) : (
                    <>
                      <span className="shrink-0 text-xs text-muted">
                        H{row.item.level}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate"
                        // Indented by level, like the outline panel.
                        style={{ paddingLeft: (row.item.level - 1) * 12 }}
                      >
                        {row.item.text}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}

            {rows.length === 0 && (
              <li className="px-2.5 py-6 text-center text-sm text-muted">
                {activeNoteId === null
                  ? "先打开一篇笔记"
                  : headings.length === 0
                    ? "当前文档没有标题"
                    : "没有匹配的标题"}
              </li>
            )}
          </ul>

          <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-[11px] text-muted">
            <span>↑↓ 选择</span>
            <span>Enter 跳转</span>
            <span>Esc 关闭</span>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
