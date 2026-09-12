import { ChevronDown, ChevronRight, FilePlus, FileText, PencilLine, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { useContextMenu, type ContextMenuEntry, type ContextMenuItem } from "@/lib/context-menu";
import { buildFolderMenu, buildNoteMenu } from "@/lib/note-menu";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note, SearchHit } from "@/types";

interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeEntry[];
  note: Note | null;
}

/** Shared empty set, so "everything expanded" is one stable identity. */
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * The notes the tree should show.
 *
 * `null` hits means nothing is being searched for, so everything shows. A search
 * narrows the tree to its matches rather than replacing the tree with a flat
 * list: the folders the matches sit in stay on screen, which is the one thing a
 * list of paths cannot tell you at a glance.
 */
export function filterNotes(notes: Note[], hits: SearchHit[] | null): Note[] {
  if (hits === null) return notes;

  const matched = new Set(hits.map((hit) => hit.noteId));
  return notes.filter((note) => matched.has(note.id));
}

/**
 * Turns the note list and the folder list into a folder tree, sorted
 * folders-first.
 *
 * Folders come from the workspace scan rather than only from note paths: a
 * folder the user just created holds no notes yet, and deriving the tree from
 * notes alone would hide it until something was put inside.
 *
 * A folder whose subtree holds no markdown at all is dropped. A workspace that is
 * a code repository has far more folders than notes — `src/components`,
 * `src-tauri/icons` — and in a list of Markdown files they are pure noise.
 * `pending` exempts folders that are empty on purpose, which is what keeps a
 * freshly created one on screen.
 */
export function buildTree(
  notes: Note[],
  folders: string[] = [],
  pending: ReadonlySet<string> = new Set(),
): TreeEntry[] {
  const root: TreeEntry = { name: "", path: "", isDir: true, children: [], note: null };

  /** Walks to `path`, creating the chain; `""` is the root itself. */
  const ensureDir = (path: string): TreeEntry => {
    let cursor = root;
    if (!path) return cursor;

    const parts = path.split("/");
    parts.forEach((part, index) => {
      const childPath = parts.slice(0, index + 1).join("/");
      let next = cursor.children.find((child) => child.path === childPath);
      if (!next) {
        next = { name: part, path: childPath, isDir: true, children: [], note: null };
        cursor.children.push(next);
      }
      cursor = next;
    });
    return cursor;
  };

  for (const folder of folders) ensureDir(folder);

  for (const note of notes) {
    const index = note.relPath.lastIndexOf("/");
    const parent = index > 0 ? note.relPath.slice(0, index) : "";
    const name = index > 0 ? note.relPath.slice(index + 1) : note.relPath;

    ensureDir(parent).children.push({
      name,
      path: note.relPath,
      isDir: false,
      children: [],
      note,
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

  return prune(root.children, pending);
}

/**
 * Drops folders that lead to no note, keeping the exempted ones.
 *
 * Bottom-up: a folder survives either because a note sits directly inside it, or
 * because a child of its survived — which is what keeps `docs` visible when only
 * `docs/guide/a.md` exists.
 */
function prune(entries: TreeEntry[], pending: ReadonlySet<string>): TreeEntry[] {
  return entries.flatMap((entry) => {
    if (!entry.isDir) return [entry];

    const children = prune(entry.children, pending);
    if (children.length === 0 && !pending.has(entry.path)) return [];
    return [{ ...entry, children }];
  });
}

/** Every folder path in the tree, for the "全部折叠" switch. */
function collectDirectories(entries: TreeEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.isDir ? [entry.path, ...collectDirectories(entry.children)] : [],
  );
}

interface RowProps {
  entry: TreeEntry;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  activeNoteId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number) => void;
  onMenu: (entry: TreeEntry, event: MouseEvent) => void;
  /** Search snippets by note id; empty unless a search is narrowing the tree. */
  snippets: ReadonlyMap<number, string>;
}

function TreeRow({
  entry,
  depth,
  collapsed,
  onToggle,
  activeNoteId,
  onSelect,
  onRename,
  onMenu,
  snippets,
}: RowProps) {
  const isCollapsed = collapsed.has(entry.path);
  const isActive = entry.note !== null && entry.note.id === activeNoteId;
  // The tree shows the folder a match sits in; the matched text itself only fits
  // in a tooltip, which is still far better than dropping it.
  const snippet = entry.note ? snippets.get(entry.note.id) : undefined;

  return (
    // The menu is bound to the row rather than the label so the rename button on
    // the right belongs to it too; the tree's background menu is on the parent.
    <li
      className="group/row relative"
      onContextMenu={(event) => onMenu(entry, event)}
    >
      <button
        type="button"
        className={cn(
          "relative flex w-full items-center gap-1.5 rounded-md py-1.5 pr-8 text-left text-sm transition-colors",
          isActive ? "font-medium" : "text-foreground/80 hover:bg-default/60",
        )}
        style={{
          paddingLeft: depth * 12 + 8,
          ...(isActive
            ? { background: "var(--qj-accent-light)", color: "var(--qj-accent-strong)" }
            : null),
        }}
        onClick={() => {
          if (entry.isDir) onToggle(entry.path);
          else if (entry.note) onSelect(entry.note.id);
        }}
        title={snippet ? `${entry.path}\n\n${snippet}` : entry.path}
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
            <ChevronRight className="size-4 shrink-0 opacity-60" />
          ) : (
            <ChevronDown className="size-4 shrink-0 opacity-60" />
          )
        ) : (
          <FileText className="size-4 shrink-0 opacity-50" />
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
          <PencilLine className="size-4" />
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
              onMenu={onMenu}
              snippets={snippets}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree() {
  const notes = useWorkspace((state) => state.notes);
  const folders = useWorkspace((state) => state.folders);
  const pendingFolders = useWorkspace((state) => state.pendingFolders);
  const activeNoteId = useWorkspace((state) => state.activeNoteId);
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const selectNote = useWorkspace((state) => state.selectNote);
  const setRenamingNoteId = useUi((state) => state.setRenamingNoteId);
  const searchHits = useUi((state) => state.searchHits);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtering = searchHits !== null;
  const visibleNotes = useMemo(() => filterNotes(notes, searchHits), [notes, searchHits]);
  const snippets = useMemo(
    () => new Map((searchHits ?? []).map((hit) => [hit.noteId, hit.snippet])),
    [searchHits],
  );

  const pending = useMemo(() => new Set(pendingFolders), [pendingFolders]);
  // A folder only survives `buildTree` when a note is inside it, so while
  // filtering the exempt set would keep empty folders on screen for no reason.
  const tree = useMemo(
    () => buildTree(visibleNotes, folders, filtering ? new Set<string>() : pending),
    [visibleNotes, folders, pending, filtering],
  );
  const directoryPaths = useMemo(() => collectDirectories(tree), [tree]);

  /**
   * Folders start folded, one seeding per workspace per session.
   *
   * The tree opens as a short list of top-level entries instead of every folder
   * at once — a workspace that is a code repository has far more folders than
   * notes, and expanding all of them buries the files. Seeding waits for the
   * first scan, and only ever happens once per workspace so that folding after
   * that belongs to the user.
   */
  const seededWorkspaces = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (activeWorkspaceId === null) return;
    if (seededWorkspaces.current.has(activeWorkspaceId)) return;
    if (directoryPaths.length === 0) return;

    seededWorkspaces.current.add(activeWorkspaceId);
    setCollapsed(new Set(directoryPaths));
  }, [activeWorkspaceId, directoryPaths]);

  // Folding is about a list you are browsing; while filtering there are only a
  // handful of rows and leaving them folded would hide the very matches the
  // search just found.
  const effectiveCollapsed = filtering ? EMPTY_COLLAPSED : collapsed;
  const allCollapsed =
    !filtering &&
    directoryPaths.length > 0 &&
    directoryPaths.every((path) => collapsed.has(path));

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openRowMenu = (entry: TreeEntry, event: MouseEvent) => {
    event.preventDefault();
    // Otherwise the tree's own menu would open over this one.
    event.stopPropagation();

    let entries: ContextMenuEntry[];
    if (entry.note) {
      entries = buildNoteMenu(entry.note, true);
    } else {
      entries = buildFolderMenu(entry.path);
      // An empty folder has nothing to fold, so the switch would be a no-op.
      if (entry.children.length > 0) {
        const isCollapsed = effectiveCollapsed.has(entry.path);
        const item: ContextMenuItem = {
          id: isCollapsed ? "folder.expand" : "folder.collapse",
          label: isCollapsed ? "展开" : "折叠",
          icon: isCollapsed ? <ChevronRight /> : <ChevronDown />,
          run: () => toggle(entry.path),
        };
        entries.push(item);
      }
    }

    useContextMenu.getState().openAt(event.clientX, event.clientY, entries);
  };

  /** Right-clicking the empty area below the rows acts on the workspace root. */
  const openBackgroundMenu = (event: MouseEvent) => {
    event.preventDefault();

    // `buildFolderMenu("")` already carries the workspace-wide rows — refresh and
    // reload from disk among them — so the background adds only the fold switch.
    const entries: ContextMenuEntry[] = [...buildFolderMenu("")];

    if (directoryPaths.length > 0 && !filtering) {
      entries.push({
        id: "tree.collapseAll",
        label: allCollapsed ? "全部展开" : "全部折叠",
        icon: allCollapsed ? <ChevronDown /> : <ChevronRight />,
        run: () => setCollapsed(allCollapsed ? new Set() : new Set(directoryPaths)),
      });
    }

    useContextMenu.getState().openAt(event.clientX, event.clientY, entries);
  };

  return (
    // `min-h-full` so the empty space under the rows is still a right-click target.
    <div className="flex min-h-full flex-col" onContextMenu={openBackgroundMenu}>
      {tree.length === 0 ? (
        filtering ? (
          <div className="qj-empty">
            <SearchX className="size-6" />
            <p className="text-xs">没有匹配的笔记</p>
            <p className="text-[11px] opacity-80">换个关键词，或清空搜索框</p>
          </div>
        ) : (
          <div className="qj-empty">
            <FilePlus className="size-6" />
            <p className="text-xs">这个工作区里还没有 Markdown 文件</p>
            <p className="text-[11px] opacity-80">右键这里，或点右上角的 + 新建</p>
          </div>
        )
      ) : (
        <ul className="px-1.5 py-1">
          {tree.map((entry) => (
            <TreeRow
              key={entry.path}
              entry={entry}
              depth={0}
              collapsed={effectiveCollapsed}
              onToggle={toggle}
              activeNoteId={activeNoteId}
              onSelect={(id) => void selectNote(id)}
              onRename={setRenamingNoteId}
              onMenu={openRowMenu}
              snippets={snippets}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
