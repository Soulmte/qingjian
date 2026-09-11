import { ChevronDown, ChevronRight, FileText, PencilLine } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { useContextMenu } from "@/lib/context-menu";
import { buildNoteMenu } from "@/lib/note-menu";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note } from "@/types";

interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeEntry[];
  note: Note | null;
}

/** Turns the flat `relPath` list into a folder tree, sorted folders-first. */
export function buildTree(notes: Note[]): TreeEntry[] {
  const root: TreeEntry = { name: "", path: "", isDir: true, children: [], note: null };

  for (const note of notes) {
    const parts = note.relPath.split("/");
    let cursor = root;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");

      let next = cursor.children.find((child) => child.path === path);
      if (!next) {
        next = {
          name: part,
          path,
          isDir: !isLeaf,
          children: [],
          note: isLeaf ? note : null,
        };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }

  const sort = (entries: TreeEntry[]) => {
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    entries.forEach((entry) => sort(entry.children));
  };
  sort(root.children);

  return root.children;
}

interface RowProps {
  entry: TreeEntry;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  activeNoteId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number) => void;
}

function TreeRow({
  entry,
  depth,
  collapsed,
  onToggle,
  activeNoteId,
  onSelect,
  onRename,
}: RowProps) {
  const isCollapsed = collapsed.has(entry.path);
  const isActive = entry.note !== null && entry.note.id === activeNoteId;

  return (
    <li className="group/row relative">
      <button
        type="button"
        className={cn(
          "relative flex w-full items-center gap-1.5 rounded-md py-1.5 pr-8 text-left text-sm transition-colors",
          isActive ? "font-medium" : "text-foreground/80 hover:bg-default/60",
        )}
        style={{
          paddingLeft: depth * 12 + 8,
          ...(isActive
            ? { background: "var(--qj-accent-light)", color: "var(--qj-accent)" }
            : null),
        }}
        onClick={() => {
          if (entry.isDir) onToggle(entry.path);
          else if (entry.note) onSelect(entry.note.id);
        }}
        onContextMenu={(event) => {
          // Folders keep the webview's own menu; a note gets the app's.
          if (!entry.note) return;
          event.preventDefault();
          useContextMenu
            .getState()
            .openAt(event.clientX, event.clientY, buildNoteMenu(entry.note));
        }}
        title={entry.path}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 w-0.5 rounded-full"
            style={{ background: "var(--qj-accent)" }}
          />
        )}
        {entry.isDir ? (
          isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 opacity-60" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          )
        ) : (
          <FileText className="size-3.5 shrink-0 opacity-50" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>

      {/* Shown on hover or while active, so the row stays quiet by default. */}
      {entry.note && (
        <button
          type="button"
          aria-label={`重命名 ${entry.name}`}
          title="重命名（F2）"
          className={cn(
            "absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-default/70 hover:text-foreground",
            isActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onRename(entry.note!.id);
          }}
        >
          <PencilLine className="size-3.5" />
        </button>
      )}

      {entry.isDir && !isCollapsed && entry.children.length > 0 && (
        <ul>
          {entry.children.map((child) => (
            <TreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              activeNoteId={activeNoteId}
              onSelect={onSelect}
              onRename={onRename}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree() {
  const notes = useWorkspace((state) => state.notes);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const selectNote = useWorkspace((state) => state.selectNote);
  const setRenamingNoteId = useUi((state) => state.setRenamingNoteId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(notes), [notes]);

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (tree.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted">这个工作区里还没有 Markdown 文件</p>;
  }

  return (
    <ul className="px-1.5 py-1">
      {tree.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          activeNoteId={activeNoteId}
          onSelect={(id) => void selectNote(id)}
          onRename={setRenamingNoteId}
        />
      ))}
    </ul>
  );
}
