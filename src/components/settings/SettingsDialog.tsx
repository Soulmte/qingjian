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
import { useEffect, useMemo, useState } from "react";

import { ToolbarButton } from "@/components/ui/ToolbarButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { describeResult, searchSettings } from "@/lib/settings-search";
import { SECTION_TITLES, SETTINGS_NAV, type SettingsSection } from "@/lib/settings-sections";
import { sectionChanged, useSettings } from "@/stores/settings";
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
  appearance: { label: SECTION_TITLES.appearance, icon: <Palette size={16} /> },
  editor: { label: SECTION_TITLES.editor, icon: <TypeIcon size={16} /> },
  code: { label: SECTION_TITLES.code, icon: <Code2 size={16} /> },
  markdown: { label: SECTION_TITLES.markdown, icon: <Sigma size={16} /> },
  image: { label: SECTION_TITLES.image, icon: <ImageIcon size={16} /> },
  export: { label: SECTION_TITLES.export, icon: <FileDown size={16} /> },
  behavior: { label: SECTION_TITLES.behavior, icon: <MousePointerClick size={16} /> },
  shortcuts: { label: SECTION_TITLES.shortcuts, icon: <Keyboard size={16} /> },
  updates: { label: SECTION_TITLES.updates, icon: <RefreshCw size={16} /> },
  about: { label: SECTION_TITLES.about, icon: <Info size={16} /> },
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

  const settings = useSettings((state) => state.settings);
  const resetSection = useSettings((state) => state.resetSection);
  const [isResetting, setIsResetting] = useState(false);

  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  /**
   * Scrolls the row that was picked from the search results into view and flashes
   * it. Runs after the section has been rendered, so the row exists by the time
   * the frame callback looks for it.
   */
  useEffect(() => {
    if (flash === null) return;

    const frame = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-setting-label="${CSS.escape(flash)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center" });
      row.classList.add("qj-setting-flash");
    });
    const timer = window.setTimeout(() => {
      document.querySelectorAll(".qj-setting-flash").forEach((row) => {
        row.classList.remove("qj-setting-flash");
      });
      // Cleared so picking the same result twice flashes again.
      setFlash(null);
    }, 1400);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [flash]);

  // Only offered when this page has been changed away from the defaults — the
  // button doubles as the answer to "have I touched anything here?".
  const changed = sectionChanged(settings, section);

  return (
    <>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={setSettingsOpen} variant="blur">
      <Modal.Container size="lg">
        <Modal.Dialog className="qj-settings" aria-label="设置">
          <div className="flex min-h-0 flex-1">
            <nav className="qj-sidebar flex w-48 shrink-0 flex-col overflow-y-auto border-r border-border/80 px-2.5 py-3">
              <input
                type="search"
                className="field mb-2.5 w-full"
                aria-label="搜索设置"
                placeholder="搜索设置…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />

              {searching ? (
                <div className="flex flex-col">
                  {results.length === 0 ? (
                    <p className="px-2 text-xs text-muted">没有匹配的设置</p>
                  ) : (
                    results.map((entry, index) => (
                      <button
                        key={`${entry.section}-${entry.group}-${entry.label}-${index}`}
                        type="button"
                        className="mb-0.5 flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-default/60"
                        onClick={() => {
                          setSettingsSection(entry.section);
                          setFlash(entry.label);
                          setQuery("");
                        }}
                      >
                        <span className="text-sm text-foreground">{entry.label}</span>
                        <span className="text-[11px] text-muted">
                          {describeResult(entry)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                SETTINGS_NAV.map((group, groupIndex) => (
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
                ))
              )}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="qj-toolbar flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-4">
                <span className="text-sm font-medium">{SECTION_TITLES[section]}</span>

                <div className="flex items-center gap-1">
                  {changed && (
                    <button
                      type="button"
                      className="qj-text-btn"
                      onClick={() => setIsResetting(true)}
                    >
                      恢复本页默认
                    </button>
                  )}
                  <ToolbarButton label="关闭设置（Esc）" onPress={() => setSettingsOpen(false)}>
                    <X />
                  </ToolbarButton>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="max-w-2xl px-5 py-5">{renderSection(section)}</div>
              </div>
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>

    <ConfirmDialog
      isOpen={isResetting}
      onOpenChange={setIsResetting}
      title={`把「${SECTION_META[section].label}」恢复默认？`}
      description="只影响这一页的设置；其它页面与笔记内容都不受影响。"
      confirmLabel="恢复默认"
      onConfirm={() => void resetSection(section)}
    />
    </>
  );
}
