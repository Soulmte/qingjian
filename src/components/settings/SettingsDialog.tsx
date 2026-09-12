import { Modal } from "@heroui/react";
import {
  Code2,
  FileDown,
  Image as ImageIcon,
  Info,
  Keyboard,
  MousePointerClick,
  Palette,
  RefreshCw,
  Sigma,
  Type as TypeIcon,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { cn } from "@/lib/cn";
import { SETTINGS_NAV, type SettingsSection } from "@/lib/settings-sections";
import { useUi } from "@/stores/ui";

import { AboutSection } from "./sections/AboutSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BehaviorSection } from "./sections/BehaviorSection";
import { CodeSection } from "./sections/CodeSection";
import { EditorSection } from "./sections/EditorSection";
import { ExportSection } from "./sections/ExportSection";
import { ImageSection } from "./sections/ImageSection";
import { MarkdownSection } from "./sections/MarkdownSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { UpdateSection } from "./sections/UpdateSection";

const SECTION_META: Record<SettingsSection, { label: string; icon: ReactNode }> = {
  appearance: { label: "外观", icon: <Palette size={16} /> },
  editor: { label: "编辑器", icon: <TypeIcon size={16} /> },
  code: { label: "代码", icon: <Code2 size={16} /> },
  markdown: { label: "Markdown", icon: <Sigma size={16} /> },
  image: { label: "图像", icon: <ImageIcon size={16} /> },
  export: { label: "导出", icon: <FileDown size={16} /> },
  behavior: { label: "行为", icon: <MousePointerClick size={16} /> },
  shortcuts: { label: "快捷键", icon: <Keyboard size={16} /> },
  updates: { label: "更新", icon: <RefreshCw size={16} /> },
  about: { label: "关于", icon: <Info size={16} /> },
};

function renderSection(section: SettingsSection) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "editor":
      return <EditorSection />;
    case "code":
      return <CodeSection />;
    case "markdown":
      return <MarkdownSection />;
    case "image":
      return <ImageSection />;
    case "export":
      return <ExportSection />;
    case "behavior":
      return <BehaviorSection />;
    case "shortcuts":
      return <ShortcutsSection />;
    case "updates":
      return <UpdateSection />;
    case "about":
      return <AboutSection />;
  }
}

/**
 * Settings live in a dialog rather than a full page: the section list is short
 * and a page-height panel left most of the window empty.
 */
export function SettingsDialog() {
  const isOpen = useUi((state) => state.isSettingsOpen);
  const section = useUi((state) => state.settingsSection);
  const setSettingsOpen = useUi((state) => state.setSettingsOpen);
  const setSettingsSection = useUi((state) => state.setSettingsSection);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setSettingsOpen} variant="blur">
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-settings" aria-label="设置">
          <div className="flex min-h-0 flex-1">
            <nav className="qj-sidebar flex w-48 shrink-0 flex-col overflow-y-auto border-r border-border/80 px-2.5 py-3">
              {SETTINGS_NAV.map((group, groupIndex) => (
                <div key={group.group}>
                  {groupIndex > 0 && <hr className="my-3 border-0 border-t border-border/80" />}
                  <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                    {group.group}
                  </p>

                  {group.sections.map((id) => {
                    const meta = SECTION_META[id];
                    const active = section === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSettingsSection(id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-accent-soft font-medium text-accent-soft-foreground"
                            : "text-foreground/75 hover:bg-default/60",
                        )}
                      >
                        <span className="shrink-0 opacity-80">{meta.icon}</span>
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="qj-toolbar flex h-12 shrink-0 items-center justify-between border-b border-border/80 px-4">
                <span className="text-sm font-medium">{SECTION_META[section].label}</span>
                <ToolbarButton label="关闭设置（Esc）" onPress={() => setSettingsOpen(false)}>
                  <X />
                </ToolbarButton>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="max-w-2xl px-5 py-5">{renderSection(section)}</div>
              </div>
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
