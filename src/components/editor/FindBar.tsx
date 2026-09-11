import { ChevronDown, ChevronUp, Replace, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { cn } from "@/lib/cn";
import {
  getActiveEditorView,
  subscribeEditor,
  subscribeEditorView,
} from "@/lib/editor/bridge";
import {
  clearSearch,
  readSearch,
  replaceAllMatches,
  replaceCurrentMatch,
  setSearchQuery,
  stepSearch,
} from "@/lib/editor/search";
import { useUi } from "@/stores/ui";

/**
 * In-editor find and replace.
 *
 * The query lives in ProseMirror (see `lib/editor/search`), not here: match
 * ranges are document positions, so React only mirrors the count and the
 * current index back for display.
 */
export function FindBar() {
  const isOpen = useUi((state) => state.isFindOpen);
  const showReplace = useUi((state) => state.findShowsReplace);
  const closeFind = useUi((state) => state.closeFind);
  const setFindShowsReplace = useUi((state) => state.setFindShowsReplace);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [generation, setGeneration] = useState(0);

  const queryInputRef = useRef<HTMLInputElement | null>(null);

  const readBack = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    const state = readSearch(view);
    setCount(state.matches.length);
    setIndex(state.index);
  }, []);

  // Push the query into the editor, and re-push it when a new editor mounts.
  useEffect(() => {
    if (!isOpen) return;
    const view = getActiveEditorView();
    if (!view) return;

    setSearchQuery(view, query, caseSensitive);
    readBack();
  }, [isOpen, query, caseSensitive, generation, readBack]);

  // Follow edits made while the bar is open.
  useEffect(() => subscribeEditor(readBack), [readBack]);
  useEffect(() => subscribeEditorView(() => setGeneration((value) => value + 1)), []);

  useEffect(() => {
    if (isOpen) queryInputRef.current?.focus();
  }, [isOpen]);

  const close = useCallback(() => {
    const view = getActiveEditorView();
    if (view) clearSearch(view);
    closeFind();
    setQuery("");
    setReplacement("");
    setCount(0);
    setIndex(0);
  }, [closeFind]);

  const step = (delta: number) => {
    const view = getActiveEditorView();
    if (!view) return;
    stepSearch(view, delta);
    readBack();
  };

  const replaceOne = () => {
    const view = getActiveEditorView();
    if (!view) return;
    replaceCurrentMatch(view, replacement);
    readBack();
  };

  const replaceEvery = () => {
    const view = getActiveEditorView();
    if (!view) return;
    replaceAllMatches(view, replacement);
    readBack();
  };

  if (!isOpen) return null;

  const counter = query.length === 0 ? "" : count === 0 ? "无结果" : `${index + 1} / ${count}`;

  return (
    <div className="qj-findbar" role="dialog" aria-label="查找与替换">
      <div className="flex items-center gap-1">
        <input
          ref={queryInputRef}
          className="field w-44"
          placeholder="查找"
          aria-label="查找内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />

        <span className="w-14 shrink-0 text-center text-xs tabular-nums text-muted">
          {counter}
        </span>

        <ToolbarButton label="上一个（Shift + Enter）" disabled={count === 0} onPress={() => step(-1)}>
          <ChevronUp />
        </ToolbarButton>
        <ToolbarButton label="下一个（Enter）" disabled={count === 0} onPress={() => step(1)}>
          <ChevronDown />
        </ToolbarButton>

        <button
          type="button"
          className={cn("qj-chip", caseSensitive && "qj-chip--on")}
          aria-pressed={caseSensitive}
          title="区分大小写"
          onClick={() => setCaseSensitive((value) => !value)}
        >
          Aa
        </button>

        <ToolbarButton
          label="显示 / 隐藏替换"
          active={showReplace}
          onPress={() => setFindShowsReplace(!showReplace)}
        >
          <Replace />
        </ToolbarButton>

        <ToolbarButton label="关闭（Esc）" onPress={close}>
          <X />
        </ToolbarButton>
      </div>

      {showReplace && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            className="field w-44"
            placeholder="替换为"
            aria-label="替换内容"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button type="button" className="qj-text-btn" disabled={count === 0} onClick={replaceOne}>
            替换
          </button>
          <button type="button" className="qj-text-btn" disabled={count === 0} onClick={replaceEvery}>
            全部替换
          </button>
        </div>
      )}
    </div>
  );
}
