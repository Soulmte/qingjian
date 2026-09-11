import { Button, Modal } from "@heroui/react";
import { FileCode, FileText, Globe, Hash, Printer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Toggle } from "@/components/settings/controls";
import { cn } from "@/lib/cn";
import { runExport } from "@/lib/commands";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { ExportFormat } from "@/types";

interface FormatOption {
  value: ExportFormat;
  label: string;
  hint: string;
  icon: ReactNode;
}

/**
 * What each format is actually good for, in the order they are offered. Word
 * leads because a thesis is the case this export exists for; Markdown trails
 * because it is a copy rather than a rendering.
 */
const FORMATS: FormatOption[] = [
  {
    value: "docx",
    label: "Word 文档",
    hint: "分级标题样式、表格与图片，适合论文与继续排版",
    icon: <FileText />,
  },
  {
    value: "pdf",
    label: "PDF",
    hint: "按当前版式直接写入文件，无页眉页脚",
    icon: <Printer />,
  },
  {
    value: "html",
    label: "网页",
    hint: "单文件网页，图片已内嵌，可直接发送",
    icon: <Globe />,
  },
  {
    value: "txt",
    label: "纯文本",
    hint: "去掉所有标记，只保留文字与空行",
    icon: <Hash />,
  },
  {
    value: "md",
    label: "Markdown",
    hint: "原样复制一份源文件，不做任何转换",
    icon: <FileCode />,
  },
];

/**
 * Asks which format to export in.
 *
 * The format used to be inferred from the default setting, which meant the one
 * thing a user wants to change at export time — the format — was buried in the
 * settings dialog. This puts the choice where the action is, and remembers it.
 */
export function ExportDialog() {
  const isOpen = useUi((state) => state.isExportOpen);
  const setOpen = useUi((state) => state.setExportOpen);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const notes = useWorkspace((state) => state.notes);

  const defaultFormat = useSettings((state) => state.settings.exportFormat);
  const defaultIncludeTitle = useSettings((state) => state.settings.exportIncludeTitle);

  const [format, setFormat] = useState<ExportFormat>("docx");
  const [includeTitle, setIncludeTitle] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setFormat(defaultFormat);
    setIncludeTitle(defaultIncludeTitle);
  }, [isOpen, defaultFormat, defaultIncludeTitle]);

  const note = notes.find((item) => item.id === activeNoteId) ?? null;

  const submit = () => {
    setOpen(false);
    void runExport(format, includeTitle);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen}>
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-dialog" aria-label="导出">
          <div className="flex items-baseline justify-between gap-3 border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-medium">导出</h2>
            <span className="truncate text-xs text-muted">{note?.relPath ?? ""}</span>
          </div>

          <div className="px-4 py-3.5">
            <div role="radiogroup" aria-label="导出格式" className="flex flex-col gap-1.5">
              {FORMATS.map((option) => {
                const active = option.value === format;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFormat(option.value)}
                    className={cn(
                      "qj-format-option flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "qj-format-option--active"
                        : "border-transparent hover:border-border/70 hover:bg-default/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0",
                        active ? "text-[color:var(--qj-accent)]" : "text-muted",
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted">{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">写入标题</span>
                <span className="mt-0.5 block text-xs text-muted">
                  把笔记标题作为文档开头的一级标题
                </span>
              </span>
              <Toggle
                ariaLabel="导出时写入标题"
                checked={includeTitle}
                onChange={setIncludeTitle}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            <Button variant="ghost" onPress={() => setOpen(false)}>
              取消
            </Button>
            <Button onPress={submit}>选择位置…</Button>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
