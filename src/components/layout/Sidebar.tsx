import { FileText, Plus, Search } from "lucide-react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { cn } from "@/lib/cn";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

import { FileTree } from "../sidebar/FileTree";
import { NotePathDialog } from "../sidebar/NotePathDialog";
import { SearchPanel } from "../sidebar/SearchPanel";
import { WorkspacePicker } from "../sidebar/WorkspacePicker";

const PANELS = [
  { key: "files", label: "文件", icon: FileText },
  { key: "search", label: "搜索", icon: Search },
] as const;

export function Sidebar({ width }: { width: number }) {
  const panel = useUi((state) => state.sidebarPanel);
  const showSidebarPanel = useUi((state) => state.showSidebarPanel);
  const isNewNoteOpen = useUi((state) => state.isNewNoteOpen);
  const setNewNoteOpen = useUi((state) => state.setNewNoteOpen);

  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const createNote = useWorkspace((state) => state.createNote);

  return (
    <aside className="qj-sidebar flex shrink-0 flex-col border-r border-border/60" style={{ width }}>
      <div className="border-b border-border/60 p-2">
        <WorkspacePicker />
      </div>

      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        {PANELS.map(({ key, label, icon: Icon }) => {
          const isActive = panel === key;
          return (
            <button
              key={key}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                !isActive && "text-muted hover:bg-default/60 hover:text-foreground",
              )}
              style={
                isActive
                  ? { background: "var(--qj-accent-light)", color: "var(--qj-accent)" }
                  : undefined
              }
              aria-current={isActive ? "true" : undefined}
              onClick={() => showSidebarPanel(key)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}

        <span className="flex-1" />

        <ToolbarButton
          label="新建笔记（Ctrl + N）"
          tone="accent"
          disabled={activeWorkspaceId === null}
          onPress={() => setNewNoteOpen(true)}
        >
          <Plus />
        </ToolbarButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === "files" ? <FileTree /> : <SearchPanel />}
      </div>

      <NotePathDialog
        isOpen={isNewNoteOpen}
        onOpenChange={setNewNoteOpen}
        heading="新建笔记"
        confirmLabel="创建"
        initialTitle="未命名"
        onSubmit={(relPath) => void createNote(relPath)}
      />
    </aside>
  );
}
