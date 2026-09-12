import { ChevronDown, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PopoverMenu, PopoverOption } from "@/components/ui/PopoverMenu";
import { cn } from "@/lib/cn";
import { workspaceFolders } from "@/lib/images";
import { useWorkspace } from "@/stores/workspace";

interface FolderPickerProps {
  /** Workspace-relative folder, or `""` for the workspace root. */
  value: string;
  onChange: (folder: string) => void;
  ariaLabel: string;
  /** Offer the workspace root as a choice. */
  allowRoot?: boolean;
  rootLabel?: string;
  /** Extra folders worth listing even when no note lives in them, e.g. `assets`. */
  extra?: string[];
  className?: string;
}

/**
 * Chooses a folder from the workspace instead of typing a path.
 *
 * The list is derived from the note index, so it only offers folders that
 * actually exist, and every row shows where it really lives. A native
 * `<select>` cannot do either — its popup is drawn by the OS, so neither the
 * paths nor the app's styling reach it.
 *
 * Do not wrap this in a `<label>`. The trigger is a `button`, which is a
 * labelable element, so a click anywhere on the label is forwarded to it as a
 * synthetic click — which toggles the menu straight back open after the
 * outside-mousedown has just closed it. Use `aria-label` plus a plain caption.
 */
export function FolderPicker({
  value,
  onChange,
  ariaLabel,
  allowRoot = true,
  rootLabel = "工作区根目录",
  extra,
  className,
}: FolderPickerProps) {
  const notes = useWorkspace((state) => state.notes);
  const workspaces = useWorkspace((state) => state.workspaces);
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);

  const rootPath =
    workspaces.find((item) => item.id === activeWorkspaceId)?.rootPath ?? "";

  const folders = useMemo(
    () => workspaceFolders(notes.map((note) => note.relPath)),
    [notes],
  );

  /** Stable dependency for the `extra` array, which callers usually inline. */
  const extraKey = (extra ?? []).join("|");
  const options = useMemo(() => {
    const merged = new Set(folders);
    for (const item of extraKey ? extraKey.split("|") : []) {
      if (item) merged.add(item);
    }
    return [...merged].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [folders, extraKey]);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Typing is still needed for a folder that does not exist yet.
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (value !== "" && !options.includes(value)) setIsTyping(true);
  }, [value, options]);

  /** Absolute location of an option, so the working directory is visible. */
  const absoluteOf = (folder: string) =>
    folder ? `${rootPath.replace(/[\\/]+$/, "")}/${folder}` : rootPath;

  if (isTyping) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <input
          autoFocus
          className="field w-52"
          aria-label={`${ariaLabel}（新文件夹）`}
          placeholder="例如：assets 或 附件/图片"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="qj-text-btn"
          onClick={() => {
            setIsTyping(false);
            onChange(options[0] ?? "");
          }}
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "field flex w-52 items-center justify-between gap-2 text-left",
          className,
        )}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{value || rootLabel}</span>
          <span className="truncate text-[11px] text-muted">{absoluteOf(value)}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>

      <PopoverMenu
        anchorRef={triggerRef}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        minWidth={320}
        ariaLabel={ariaLabel}
      >
        {allowRoot && (
          <PopoverOption
            selected={value === ""}
            secondary={rootPath}
            onSelect={() => {
              setIsOpen(false);
              onChange("");
            }}
          >
            {rootLabel}
          </PopoverOption>
        )}

        {options.map((folder) => (
          <PopoverOption
            key={folder}
            selected={value === folder}
            secondary={absoluteOf(folder)}
            onSelect={() => {
              setIsOpen(false);
              onChange(folder);
            }}
          >
            {folder}
          </PopoverOption>
        ))}

        <button
          type="button"
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border/80 px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-default/60 hover:text-foreground"
          onClick={() => {
            setIsOpen(false);
            setIsTyping(true);
          }}
        >
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          新建文件夹…
        </button>
      </PopoverMenu>
    </>
  );
}
