import { useEffect, useState } from "react";

import { countCharacters, countWords } from "@/lib/markdown";
import { useWorkspace, type SaveState } from "@/stores/workspace";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "未保存",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败",
  conflict: "文件已外部修改",
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
 */
function useDocumentStats(content: string, loaded: boolean) {
  const [stats, setStats] = useState({ words: 0, characters: 0 });

  useEffect(() => {
    if (!loaded) {
      setStats({ words: 0, characters: 0 });
      return;
    }

    const timer = window.setTimeout(() => {
      setStats({ words: countWords(content), characters: countCharacters(content) });
    }, STATS_DELAY);

    return () => window.clearTimeout(timer);
  }, [content, loaded]);

  return stats;
}

export function StatusBar() {
  const content = useWorkspace((state) => state.content);
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const saveState = useWorkspace((state) => state.saveState);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const notes = useWorkspace((state) => state.notes);

  const note = notes.find((item) => item.id === activeNoteId) ?? null;
  const { words, characters } = useDocumentStats(content, contentLoaded);

  if (activeNoteId === null) return null;

  return (
    <footer className="status-bar qj-toolbar">
      <span className="truncate text-muted">{note?.relPath ?? ""}</span>
      <span className="flex shrink-0 items-center gap-4">
        <span className="text-muted">
          {words} 词 · {characters} 字符
        </span>
        <span
          className={
            saveState === "error"
              ? "text-danger"
              : saveState === "dirty" || saveState === "conflict"
                ? "text-warning"
                : "text-muted"
          }
        >
          {SAVE_LABEL[saveState]}
        </span>
      </span>
    </footer>
  );
}
