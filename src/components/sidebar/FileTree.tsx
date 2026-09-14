import { ChevronDown, ChevronRight, FilePlus, FileText, PencilLine, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { useContextMenu, type ContextMenuEntry, type ContextMenuItem } from "@/lib/context-menu";
import { buildFolderMenu, buildNoteMenu } from "@/lib/note-menu";
import { useVirtualList } from "@/lib/use-virtual-list";
import { flattenTree } from "@/lib/virtual-list";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { Note, SearchHit } from "@/types";

/**
 * 行高写死是虚拟化的前提：知道行号就能算出像素位置，不必先渲染再量。
 *
 * 换行高度的代价是长文件名会被截断——本来就是 `truncate`，没有损失。
 */
const ROW_HEIGHT = 32;
/**
 * 列表上下左右的内边距。
 *
 * 绝对定位的子元素不吃父级的 padding（定位的参照物是 padding box），所以这些
 * 留白得自己算进坐标，否则行会顶到边上。
 */
const PAD_Y = 4;
const PAD_X = 6;

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
  isCollapsed: boolean;
  /** 行在内容里的绝对位置，由虚拟列表算好。 */
  top: number;
  activeNoteId: number | null;
  onToggle: (path: string) => void;
  onSelect: (id: number) => void;
  onRename: (id: number) => void;
  onMenu: (entry: TreeEntry, event: MouseEvent) => void;
  /** Search snippets by note id; empty unless a search is narrowing the tree. */
  snippets: ReadonlyMap<number, string>;
}

function TreeRow({
  entry,
  depth,
  isCollapsed,
  top,
  activeNoteId,
  onToggle,
  onSelect,
  onRename,
  onMenu,
  snippets,
}: RowProps) {
  const isActive = entry.note !== null && entry.note.id === activeNoteId;
  // The tree shows the folder a match sits in; the matched text itself only fits
  // in a tooltip, which is still far better than dropping it.
  const snippet = entry.note ? snippets.get(entry.note.id) : undefined;

  return (
    // The menu is bound to the row rather than the label so the rename button on
    // the right belongs to it too; the tree's background menu is on the parent.
    //
    // 行是绝对定位的：它不吃父级的 padding，所以四边留白自己算。
    <li
      className="group/row absolute"
      style={{ top, height: ROW_HEIGHT, left: PAD_X, right: PAD_X }}
      onContextMenu={(event) => onMenu(entry, event)}
    >
      <button
        type="button"
        className={cn(
          "relative flex h-full w-full items-center gap-1.5 rounded-md pr-8 text-left text-sm transition-colors",
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

  /**
   * 树先摊平再渲染。
   *
   * 摊平之后行号就是像素位置，折叠又已经把看不见的行从数组里去掉了——「只渲染
   * 看得见的那几十行」就只需要对着这个数组取一段，不必在递归里传视口信息。
   */
  const rows = useMemo(
    () => flattenTree(tree, effectiveCollapsed),
    [tree, effectiveCollapsed],
  );
  const { ref: scrollRef, range } = useVirtualList(rows.length, ROW_HEIGHT, PAD_Y);

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
    <div className="flex h-full flex-col" onContextMenu={openBackgroundMenu}>
      {rows.length === 0 ? (
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
        // 滚动容器归文件树自己拿：虚拟化要知道滚到哪里了，而高度可能是被一个
        // 抽屉式的侧栏动画改的，从外面传引用进来只会多一层麻烦。
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* 占位盒子把滚动条的长度堆出来，里面只放当前这一段行。 */}
          <div className="relative" style={{ height: range.totalHeight }}>
            <ul>
              {rows.slice(range.start, range.end).map((row, index) => (
                <TreeRow
                  key={row.node.path}
                  entry={row.node}
                  depth={row.depth}
                  isCollapsed={effectiveCollapsed.has(row.node.path)}
                  top={range.offsetY + index * ROW_HEIGHT}
                  activeNoteId={activeNoteId}
                  onToggle={toggle}
                  onSelect={(id) => void selectNote(id)}
                  onRename={setRenamingNoteId}
                  onMenu={openRowMenu}
                  snippets={snippets}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
