import { Check, CircleAlert, History, LoaderCircle, PencilLine, Pin, Type } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { countCharacters, countWords } from "@/lib/markdown";
import { useUi } from "@/stores/ui";
import { useWorkspace, type SaveState } from "@/stores/workspace";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "未保存",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败",
  conflict: "文件已外部修改",
};

/** 每种保存状态配一个图标；`idle` 没有文案，也就不需要图标。 */
const SAVE_ICON: Record<SaveState, ComponentType<{ className?: string }> | null> = {
  idle: null,
  dirty: PencilLine,
  saving: LoaderCircle,
  saved: Check,
  error: CircleAlert,
  conflict: CircleAlert,
};

/** How long after the last keystroke the counts are recomputed. */
const STATS_DELAY = 250;

/**
 * Word and character counts for the open note.
 *
 * Both counts walk the whole document, so recomputing them on every keystroke is
 * one of the things that made a large note feel sticky. They are cosmetic, so
 * they are allowed to settle a beat after typing stops rather than run on every
 * character.
 *
 * The text is read from the store rather than taken as a prop, so a keystroke no
 * longer re-renders the status bar at all: the subscription is to `contentLoaded`
 * and the note, and the counts are pulled out of the store when the timer fires.
 * Subscribing to `content` here meant React reconciled the footer on every
 * character just to show a number that had not been recomputed yet.
 */
function useDocumentStats(loaded: boolean, noteId: number | null) {
  const [stats, setStats] = useState({ words: 0, characters: 0 });

  useEffect(() => {
    if (!loaded) {
      setStats({ words: 0, characters: 0 });
      return;
    }

    let timer: number | null = null;

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const { content } = useWorkspace.getState();
        setStats({ words: countWords(content), characters: countCharacters(content) });
      }, STATS_DELAY);
    };

    schedule();

    // Only the text matters here; a save or a selection change must not restart
    // the timer, or a long note being autosaved would keep deferring its count.
    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (state.content !== previous.content) schedule();
    });

    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loaded, noteId]);

  return stats;
}

export function StatusBar() {
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const saveState = useWorkspace((state) => state.saveState);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const notes = useWorkspace((state) => state.notes);
  const snapshotNow = useWorkspace((state) => state.snapshotNow);
  // 历史版本入口就在这一栏：侧栏的右键菜单里也有一份，但那条路径要先找到那一行。
  const setHistoryNoteId = useUi((state) => state.setHistoryNoteId);
  /** 钉完那一句话，几秒后自己消失——这一栏没有别的地方能回话。 */
  const [pinNotice, setPinNotice] = useState<string | null>(null);

  const note = notes.find((item) => item.id === activeNoteId) ?? null;
  const { words, characters } = useDocumentStats(contentLoaded, activeNoteId);

  useEffect(() => {
    if (!pinNotice) return;
    const timer = window.setTimeout(() => setPinNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [pinNotice]);

  if (activeNoteId === null) return null;

  const SaveIcon = SAVE_ICON[saveState];
  const saveTone =
    saveState === "error"
      ? "text-danger"
      : saveState === "dirty" || saveState === "conflict"
        ? "text-warning"
        : "qj-text-secondary";

  return (
    <footer className="status-bar qj-toolbar">
      <span className="truncate qj-text-secondary">{note?.relPath ?? ""}</span>
      <span className="flex shrink-0 items-center gap-4">
        <button
          type="button"
          className="qj-status-action"
          title="历史版本（右键侧栏里的笔记也有这一项）"
          onClick={() => setHistoryNoteId(activeNoteId)}
        >
          <History aria-hidden />
          历史版本
        </button>
        <button
          type="button"
          className="qj-status-action"
          title="把现在这一刻记进历史；手动记下的版本不会被自动清理掉"
          onClick={() => {
            void snapshotNow().then((added) =>
              setPinNotice(added ? "已记下一个版本" : "与最新一版相同"),
            );
          }}
        >
          <Pin aria-hidden />
          记一个版本
        </button>
        {pinNotice && (
          <span className="qj-text-secondary" style={{ color: "var(--qj-accent-strong)" }}>
            {pinNotice}
          </span>
        )}
        <span className="flex items-center gap-1.5 qj-text-secondary" title="字数统计">
          <Type aria-hidden />
          {words} 词 · {characters} 字符
        </span>
        {SAVE_LABEL[saveState] && (
          <span className={cn("flex items-center gap-1.5", saveTone)}>
            {SaveIcon && (
              <SaveIcon className={saveState === "saving" ? "animate-spin" : undefined} />
            )}
            {SAVE_LABEL[saveState]}
          </span>
        )}
      </span>
    </footer>
  );
}
