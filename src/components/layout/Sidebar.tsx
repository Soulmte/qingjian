import { Plus, RotateCw } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { useContextMenu, type ContextMenuItem } from "@/lib/context-menu";
import { buildCreateMenu, buildReloadMenu } from "@/lib/note-menu";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

import { FileTree } from "../sidebar/FileTree";
import { NotePathDialog } from "../sidebar/NotePathDialog";
import { SidebarSearch } from "../sidebar/SidebarSearch";
import { WorkspacePicker } from "../sidebar/WorkspacePicker";

interface SidebarMenuButtonProps {
  /** Used as the accessible name and the tooltip. */
  label: string;
  icon: ReactNode;
  /** Built on press, so the rows carry the enabled state of that moment. */
  entries: () => ContextMenuItem[];
  tone?: "default" | "accent";
  disabled?: boolean;
}

/**
 * A sidebar icon button that drops down menu rows.
 *
 * It reuses the app's context menu rather than a separate popover: a dropdown and
 * a right-click are then the same control down to the styling, and both read
 * their rows from the same builders. Those rows have to exist outside the tree
 * because a sidebar full of files has no blank area left to right-click, which is
 * where 新建 and 刷新 would otherwise live.
 */
function SidebarMenuButton({
  label,
  icon,
  entries,
  tone = "default",
  disabled = false,
}: SidebarMenuButtonProps) {
  const anchor = useRef<HTMLButtonElement | null>(null);

  return (
    <ToolbarButton
      ref={anchor}
      label={label}
      tone={tone}
      disabled={disabled}
      onPress={() => {
        const node = anchor.current;
        if (!node) return;

        const { menu, openAt, close } = useContextMenu.getState();
        if (menu?.anchor === node) {
          close();
          return;
        }

        const rect = node.getBoundingClientRect();
        openAt(rect.left, rect.bottom + 4, entries(), node);
      }}
    >
      {icon}
    </ToolbarButton>
  );
}

export function Sidebar({ width }: { width: number }) {
  const isNewNoteOpen = useUi((state) => state.isNewNoteOpen);
  const setNewNoteOpen = useUi((state) => state.setNewNoteOpen);
  const isNewFolderOpen = useUi((state) => state.isNewFolderOpen);
  const setNewFolderOpen = useUi((state) => state.setNewFolderOpen);
  const newEntryFolder = useUi((state) => state.newEntryFolder);

  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const createNote = useWorkspace((state) => state.createNote);
  const createFolder = useWorkspace((state) => state.createFolder);

  return (
    <aside className="qj-sidebar flex shrink-0 flex-col border-r border-border/80" style={{ width }}>
      <div className="border-b border-border/80 p-2">
        <WorkspacePicker />
      </div>

      {/*
        Three bands: what the actions belong to, the search box, then the tree.

        Search used to be a panel switch, which meant searching cost you the view
        of where notes live — the one thing a list of results cannot replace. As
        its own row it narrows the tree below instead of hiding it.
      */}
      <div className="flex items-center gap-1 border-b border-border/80 px-2 py-1.5">
        <span className="px-1 text-xs font-medium text-muted">文件</span>

        <span className="flex-1" />

        <SidebarMenuButton
          label="刷新"
          icon={<RotateCw />}
          entries={buildReloadMenu}
          disabled={activeWorkspaceId === null}
        />
        <SidebarMenuButton
          label="新建笔记或文件夹"
          icon={<Plus />}
          tone="accent"
          entries={buildCreateMenu}
          disabled={activeWorkspaceId === null}
        />
      </div>

      <SidebarSearch />

      {/* 滚动容器在文件树内部：虚拟化要知道滚到哪里了，让外面包一层只会多一份
          需要同步的状态。 */}
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>

      <NotePathDialog
        isOpen={isNewNoteOpen}
        onOpenChange={setNewNoteOpen}
        heading="新建笔记"
        confirmLabel="创建"
        initialFolder={newEntryFolder}
        initialTitle="未命名"
        onSubmit={(relPath) => void createNote(relPath)}
      />

      <NotePathDialog
        isOpen={isNewFolderOpen}
        onOpenChange={setNewFolderOpen}
        heading="新建文件夹"
        confirmLabel="创建"
        kind="folder"
        initialFolder={newEntryFolder}
        initialTitle="新建文件夹"
        onSubmit={(relDir) => void createFolder(relDir)}
      />
    </aside>
  );
}
