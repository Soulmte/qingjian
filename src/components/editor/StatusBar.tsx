import { countWords } from "@/lib/markdown";
import { useWorkspace, type SaveState } from "@/stores/workspace";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "未保存",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败",
  conflict: "文件已外部修改",
};

export function StatusBar() {
  const content = useWorkspace((state) => state.content);
  const contentLoaded = useWorkspace((state) => state.contentLoaded);
  const saveState = useWorkspace((state) => state.saveState);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const notes = useWorkspace((state) => state.notes);

  const note = notes.find((item) => item.id === activeNoteId) ?? null;
  const words = contentLoaded ? countWords(content) : 0;
  const characters = contentLoaded ? Array.from(content).length : 0;

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
