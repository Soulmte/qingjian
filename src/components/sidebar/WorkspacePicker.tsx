import { Button, Modal } from "@heroui/react";
import { ChevronDown, FolderOpen, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/stores/workspace";

export function WorkspacePicker() {
  const workspaces = useWorkspace((state) => state.workspaces);
  const activeWorkspaceId = useWorkspace((state) => state.activeWorkspaceId);
  const selectWorkspace = useWorkspace((state) => state.selectWorkspace);
  const addWorkspaceFromPicker = useWorkspace((state) => state.addWorkspaceFromPicker);
  const removeWorkspace = useWorkspace((state) => state.removeWorkspace);

  const [isOpen, setIsOpen] = useState(false);
  const active = workspaces.find((item) => item.id === activeWorkspaceId) ?? null;

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-default/60"
        onClick={() => setIsOpen(true)}
        title={active?.rootPath ?? "选择一个本地文件夹"}
        aria-label={active ? `工作区 ${active.name}，${active.rootPath}` : "打开工作区"}
      >
        <FolderOpen className="size-4 shrink-0 opacity-60" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{active?.name ?? "打开工作区"}</span>
          {/* The path is what tells two folders of the same name apart. */}
          <span className="truncate text-[11px] qj-text-secondary">
            {active?.rootPath ?? "选择一个本地文件夹"}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>

      <Modal.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
        <Modal.Container size="lg">
          <Modal.Dialog className="qj-dialog" aria-label="工作区">
            <div className="border-b border-border/80 px-4 py-3">
              <h2 className="text-sm font-medium">工作区</h2>
            </div>

            <div className="px-4 py-3">
              {workspaces.length === 0 ? (
                <div className="qj-empty">
                  <FolderPlus className="size-6" />
                  <p className="text-sm">还没有打开任何文件夹</p>
                  <p className="text-[11px] opacity-80">点下面的「打开本地文件夹」选一个目录</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {workspaces.map((workspace) => (
                    <li key={workspace.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        className={cn(
                          "flex min-w-0 flex-1 flex-col rounded-lg px-3 py-2 text-left transition-colors",
                          workspace.id === activeWorkspaceId
                            ? "bg-accent-soft text-accent-soft-foreground"
                            : "hover:bg-default/60",
                        )}
                        onClick={() => {
                          setIsOpen(false);
                          void selectWorkspace(workspace.id);
                        }}
                      >
                        <span className="truncate text-sm font-medium">{workspace.name}</span>
                        <span className="truncate text-[11px] qj-text-secondary">
                          {workspace.rootPath}
                        </span>
                      </button>
                      <ToolbarButton
                        label="移除工作区（不会删除磁盘文件）"
                        tone="danger"
                        onPress={() => void removeWorkspace(workspace.id)}
                      >
                        <Trash2 />
                      </ToolbarButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border/80 px-4 py-2.5">
              <Button
                fullWidth
                variant="secondary"
                onPress={() => {
                  setIsOpen(false);
                  void addWorkspaceFromPicker();
                }}
              >
                <Plus className="size-4" />
                打开本地文件夹
              </Button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
