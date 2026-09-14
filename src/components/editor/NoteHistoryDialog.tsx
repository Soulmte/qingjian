import { Button, Modal } from "@heroui/react";
import { History, Pin, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { parseMarkdown } from "@/lib/export/ir";
import { exportStylePayload, resolveImageFile } from "@/lib/export/styles";
import { formatRevisionTime } from "@/lib/time";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { NoteRevision } from "@/types";

/**
 * 一篇笔记的历史版本。
 *
 * 只列覆盖之前留下的旧稿：删除有系统回收站，外部改动有冲突提示，只有「改坏了
 * 还存了盘」这一步在 0.1.8 之前是不可逆的。
 *
 * 预览走的是**导出那条渲染管线**（`parseMarkdown` → `renderExport`），不是另写
 * 一个 Markdown 渲染器：这是全应用唯一一处把 Markdown 变成 HTML 的地方，再写一
 * 份的话，两边的标题层级、列表编号、表格样式迟早会对不上，看历史时看到的就不再
 * 是笔记本来的样子。图片也照导出那样按笔记所在的目录解析，所以历史里的图能显示。
 *
 * 恢复走的是普通保存那条路，不做冲突检查——点「恢复」本身就是明确的覆盖决定；
 * 而后端在写之前会先给当前这一版记一条历史，所以恢复错了还能恢复回来。
 */
export function NoteHistoryDialog() {
  const noteId = useUi((state) => state.historyNoteId);
  const setNoteId = useUi((state) => state.setHistoryNoteId);
  const restoreRevision = useWorkspace((state) => state.restoreRevision);
  const snapshotNow = useWorkspace((state) => state.snapshotNow);
  const saveState = useWorkspace((state) => state.saveState);
  const notes = useWorkspace((state) => state.notes);
  const workspaces = useWorkspace((state) => state.workspaces);
  const settings = useSettings((state) => state.settings);

  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [html, setHtml] = useState("");
  const [rendering, setRendering] = useState(false);
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
    setHtml("");
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

  /**
   * 选中那一版渲染成 HTML。
   *
   * 用导出那一套排版（字体、标题阶梯、代码底色都是用户自己调的），只把标题留空：
   * 历史版本的第一行通常就是标题，再在上面加一条文档标题会重复。图片按笔记所在
   * 目录解析，所以历史里的图也显示得出来。
   */
  useEffect(() => {
    if (selectedId === null) {
      setHtml("");
      return;
    }

    let cancelled = false;
    setRendering(true);

    void (async () => {
      try {
        const detail = await api.readNoteRevision(selectedId);
        if (cancelled) return;

        const root = workspaces.find((item) => item.id === note?.workspaceId)?.rootPath ?? "";
        const blocks = parseMarkdown(detail.content, {
          resolveImageFile: (src) => resolveImageFile(src, note?.relPath ?? "", root),
        });
        const rendered = await api.renderExport({
          blocks,
          styles: { ...exportStylePayload(settings, ""), title: "" },
        });
        if (!cancelled) {
          setHtml(rendered);
          setError(null);
        }
      } catch (problem) {
        if (!cancelled) setError(errorMessage(problem));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, note?.workspaceId, note?.relPath, workspaces, settings]);

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

  /**
   * 把现在这一刻钉住。
   *
   * 与恢复不同，它不动文件，只是多留一版——用在「我马上要大改这篇」的时候。
   * 手动钉的版本不参与裁剪，所以不用担心以后被挤掉。
   */
  const pin = async () => {
    if (noteId === null) return;

    setBusy(true);
    setError(null);
    try {
      const added = await snapshotNow();
      await loadList(noteId);
      if (!added) setError("与最新一版内容相同，没有重复记");
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && setNoteId(null)}>
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-history" aria-label="历史版本">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">历史版本</h2>
              <p className="truncate text-xs text-muted">
                {note ? note.title : ""}
                {revisions.length > 0 && ` · 共 ${revisions.length} 版`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" isDisabled={busy} onPress={() => void pin()}>
                <Pin className="size-4" />
                记一个版本
              </Button>
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
          </div>

          {revisions.length === 0 ? (
            <div className="qj-empty min-h-0 flex-1 px-4 py-10">
              <History className="size-6" />
              <p className="text-xs">还没有历史版本</p>
              <p className="text-[11px] opacity-80">
                保存时自动留档，同一篇间隔不足 5 分钟不会重复记；自动版本保留最近 100 版
              </p>
              <p className="text-[11px] opacity-80">
                「记一个版本」钉下的不会被清理，适合动手大改之前先钉一个
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <ul className="w-60 shrink-0 overflow-y-auto border-r border-border/80 py-1">
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
                          {revision.isManual && (
                            <Pin
                              aria-label="手动记下的"
                              className="mr-1 inline size-3 align-[-2px]"
                            />
                          )}
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

              <div className="relative min-h-0 flex-1 bg-white">
                {html ? (
                  <iframe
                    title="历史版本预览"
                    // No scripts, no same-origin: the renderer only produces markup,
                    // and a preview has no business running anything.
                    sandbox=""
                    srcDoc={html}
                    className="h-full w-full"
                  />
                ) : (
                  <p className="p-4 text-xs text-muted">
                    {rendering ? "正在渲染…" : "选一版看看"}
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="shrink-0 border-t border-border/80 px-4 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
