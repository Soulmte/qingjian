import { Button, Modal } from "@heroui/react";
import { History, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRevisionTime } from "@/lib/time";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { NoteRevision } from "@/types";

/**
 * 一篇笔记的历史版本。
 *
 * 只列覆盖之前留下的旧稿：删除有系统回收站，外部改动有冲突提示，只有「改坏了
 * 还存了盘」这一步在 0.1.8 之前是不可逆的。
 *
 * 恢复走的是普通保存那条路，不做冲突检查——点「恢复」本身就是明确的覆盖决定；
 * 而后端在写之前会先给当前这一版记一条历史，所以恢复错了还能恢复回来。
 */
export function NoteHistoryDialog() {
  const noteId = useUi((state) => state.historyNoteId);
  const setNoteId = useUi((state) => state.setHistoryNoteId);
  const restoreRevision = useWorkspace((state) => state.restoreRevision);
  const saveState = useWorkspace((state) => state.saveState);
  const notes = useWorkspace((state) => state.notes);

  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const note = notes.find((item) => item.id === noteId) ?? null;
  const isOpen = noteId !== null;

  const loadList = useCallback(async (id: number) => {
    const found = await api.listNoteRevisions(id);
    setRevisions(found);
    return found;
  }, []);

  useEffect(() => {
    if (noteId === null) return;

    let cancelled = false;
    setError(null);
    setPreview("");
    setSelectedId(null);

    void (async () => {
      try {
        const found = await loadList(noteId);
        if (cancelled) return;
        // 默认选中最新的一版：多数时候用户想看的就是「上一次保存之前长什么样」。
        setSelectedId(found[0]?.id ?? null);
      } catch (problem) {
        if (!cancelled) setError(errorMessage(problem));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, loadList]);

  useEffect(() => {
    if (selectedId === null) {
      setPreview("");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const detail = await api.readNoteRevision(selectedId);
        if (!cancelled) setPreview(detail.content);
      } catch (problem) {
        if (!cancelled) setError(errorMessage(problem));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const restore = async () => {
    if (selectedId === null || noteId === null) return;

    setBusy(true);
    setError(null);
    try {
      await restoreRevision(selectedId);
      // 恢复之后会多出一条历史（恢复前的那一版），列表要重读。
      await loadList(noteId);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && setNoteId(null)}>
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-dialog" aria-label="历史版本">
          <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">历史版本</h2>
              <p className="truncate text-xs text-muted">
                {note ? note.title : ""}
                {revisions.length > 0 && ` · 保留最近 ${revisions.length} 版`}
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              isDisabled={selectedId === null || busy || saveState === "saving"}
              onPress={() => void restore()}
            >
              <RotateCcw className="size-4" />
              恢复这一版
            </Button>
          </div>

          {revisions.length === 0 ? (
            <div className="qj-empty px-4 py-10">
              <History className="size-6" />
              <p className="text-xs">还没有历史版本</p>
              <p className="text-[11px] opacity-80">
                这一版之前的改动会在下次保存时自动留档；保留最近 50 版
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <ul className="w-64 shrink-0 overflow-y-auto border-r border-border/80 py-1">
                {revisions.map((revision) => {
                  const isSelected = revision.id === selectedId;
                  return (
                    <li key={revision.id}>
                      <button
                        type="button"
                        className={cn(
                          "w-full px-3 py-2 text-left transition-colors",
                          isSelected ? "bg-default/70" : "hover:bg-default/40",
                        )}
                        onClick={() => setSelectedId(revision.id)}
                      >
                        <span
                          className="block text-xs font-medium"
                          style={isSelected ? { color: "var(--qj-accent-strong)" } : undefined}
                        >
                          {formatRevisionTime(revision.createdAt)}
                        </span>
                        <span className="block truncate text-[11px] text-muted">
                          {revision.preview || "（空）"}
                        </span>
                        <span className="block text-[11px] text-muted opacity-70">
                          {revision.size} 字符
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <pre
                className="min-h-0 flex-1 overflow-auto px-4 py-3 text-xs whitespace-pre-wrap"
                style={{ fontFamily: "var(--qj-font-mono)" }}
              >
                {preview}
              </pre>
            </div>
          )}

          {error && (
            <p className="border-t border-border/80 px-4 py-2 text-xs text-danger">{error}</p>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
