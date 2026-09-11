import { Button, Modal } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import { FolderPicker } from "@/components/ui/FolderPicker";

interface NotePathDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  heading: string;
  confirmLabel: string;
  /** Folder to preselect; `""` is the workspace root. */
  initialFolder?: string;
  /** Title without the `.md` extension. */
  initialTitle?: string;
  onSubmit: (relPath: string) => void;
}

/** Characters Windows rejects in a file name, plus the path separators. */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Turns a typed title into a file name.
 *
 * The Rust side normalises and bounds the path it receives, but doing the same
 * here keeps the "将创建" preview equal to what actually lands on disk — a
 * separator in the title would otherwise silently become a folder.
 */
function sanitizeTitle(title: string): string {
  return title
    .replace(ILLEGAL, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim();
}

/**
 * Creates or renames a note from a folder and a title.
 *
 * The path used to be one free-text field, which meant typing separators and
 * guessing which folders existed. Picking the folder from the workspace's own
 * tree and deriving the path from the title is both shorter to fill in and
 * impossible to get wrong — and it makes a rename able to move the file at the
 * same time.
 */
export function NotePathDialog({
  isOpen,
  onOpenChange,
  heading,
  confirmLabel,
  initialFolder = "",
  initialTitle = "",
  onSubmit,
}: NotePathDialogProps) {
  const [folder, setFolder] = useState(initialFolder);
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (!isOpen) return;
    setFolder(initialFolder);
    setTitle(initialTitle);
  }, [isOpen, initialFolder, initialTitle]);

  const clean = useMemo(() => sanitizeTitle(title), [title]);

  const relPath = useMemo(() => {
    const name = `${clean}.md`;
    return folder ? `${folder}/${name}` : name;
  }, [clean, folder]);

  const canSubmit = clean.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(relPath);
    onOpenChange(false);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-dialog" aria-label={heading}>
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-medium">{heading}</h2>
          </div>

          <div className="space-y-3 px-4 py-4">
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted">文件夹</span>
              <FolderPicker
                ariaLabel="笔记文件夹"
                value={folder}
                onChange={setFolder}
                className="w-full justify-between"
              />
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted">文件名</span>
              <input
                autoFocus
                className="field w-full"
                aria-label="文件名"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </label>

            <p className="text-xs text-muted">
              路径：
              <span className="ml-1 font-mono text-foreground">{relPath}</span>
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            <Button variant="ghost" onPress={() => onOpenChange(false)}>
              取消
            </Button>
            <Button isDisabled={!canSubmit} onPress={submit}>
              {confirmLabel}
            </Button>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
