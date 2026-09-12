import { Modal } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { rankByFuzzy } from "@/lib/fuzzy";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note } from "@/types";

/**
 * Typora's "快速打开": jump to any note in the open workspace.
 *
 * Candidates are ranked by how recently they were edited as well as by match
 * quality, so an empty query lists recent work first — which is what the
 * shortcut is usually reached for.
 */
export function QuickOpen() {
  const isOpen = useUi((state) => state.isQuickOpen);
  const setQuickOpen = useUi((state) => state.setQuickOpen);

  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const selectNote = useWorkspace((state) => state.selectNote);

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

  const results = useMemo(() => {
    const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query.trim()) return recent.slice(0, 50);

    const ranked = rankByFuzzy(recent, query, (note: Note) => `${note.title} ${note.relPath}`);
    return ranked.slice(0, 50);
  }, [notes, query]);

  // Keep the highlighted row inside the scroll viewport while arrowing around.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const open = (note: Note) => {
    setQuickOpen(false);
    void selectNote(note.id);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setQuickOpen} variant="blur">
      <Modal.Container size="lg" placement="top">
        <Modal.Dialog className="qj-palette" aria-label="快速打开">
          <div className="border-b border-border/80 p-2">
            <input
              autoFocus
              className="field w-full"
              placeholder="输入笔记标题…"
              aria-label="搜索笔记"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const note = results[activeIndex];
                  if (note) open(note);
                }
              }}
            />
          </div>

          <ul
            ref={listRef}
            role="listbox"
            aria-label="笔记"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {results.map((note, index) => (
              <li key={note.id}>
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
                  onClick={() => open(note)}
                >
                  <span className="min-w-0 flex-1 truncate">{note.title}</span>
                  {note.id === activeNoteId && (
                    <span className="shrink-0 text-[11px] text-muted">当前</span>
                  )}
                  <span className="shrink-0 truncate text-xs text-muted">{note.relPath}</span>
                </button>
              </li>
            ))}

            {results.length === 0 && (
              <li className="px-2.5 py-6 text-center text-sm text-muted">
                {notes.length === 0 ? "当前工作区还没有笔记" : "没有匹配的笔记"}
              </li>
            )}
          </ul>

          <div className="flex items-center gap-3 border-t border-border/80 px-3 py-1.5 text-[11px] text-muted">
            <span>↑↓ 选择</span>
            <span>Enter 打开</span>
            <span>Esc 关闭</span>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
