import { Modal } from "@heroui/react";
import {
  Code2,
  Image as ImageIcon,
  Info,
  Keyboard,
  MousePointerClick,
  Palette,
  Sigma,
  Type as TypeIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { APP_COMMANDS } from "@/lib/commands";
import { rankByFuzzy } from "@/lib/fuzzy";
import type { SettingsSection } from "@/lib/settings-sections";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import type { AccentName } from "@/types";

interface PaletteEntry {
  id: string;
  title: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  run: () => void;
}

const SETTINGS_COMMANDS: { section: SettingsSection; title: string; icon: ReactNode }[] = [
  { section: "appearance", title: "设置：外观", icon: <Palette size={15} /> },
  { section: "editor", title: "设置：编辑器", icon: <TypeIcon size={15} /> },
  { section: "code", title: "设置：代码", icon: <Code2 size={15} /> },
  { section: "markdown", title: "设置：Markdown", icon: <Sigma size={15} /> },
  { section: "image", title: "设置：图像", icon: <ImageIcon size={15} /> },
  { section: "behavior", title: "设置：行为", icon: <MousePointerClick size={15} /> },
  { section: "shortcuts", title: "设置：快捷键", icon: <Keyboard size={15} /> },
  { section: "about", title: "设置：关于", icon: <Info size={15} /> },
];

const ACCENT_LABELS: Record<AccentName, string> = {
  bamboo: "竹青",
  ink: "墨蓝",
  rouge: "胭脂",
  ochre: "赭石",
  violet: "黛紫",
  teal: "苍碧",
  mono: "墨白",
  gamboge: "藤黄",
  idea: "IDEA 蓝",
};

/**
 * The palette lists the shared command registry, plus one entry per settings
 * section and accent.
 *
 * Settings sections and accents are generated rather than registered: they are
 * parameterised (`openSettings(section)`, `update("accent", name)`), so a
 * registry entry each would be four lines of boilerplate apiece for the same
 * behaviour.
 */
function buildEntries(): PaletteEntry[] {
  const ui = () => useUi.getState();
  const settings = () => useSettings.getState();

  const entries: PaletteEntry[] = APP_COMMANDS.map((command) => ({
    id: command.id,
    title: command.title,
    group: command.group,
    icon: command.icon,
    shortcut: command.shortcut,
    run: () => void command.run(),
  }));

  for (const [accent, title] of Object.entries(ACCENT_LABELS) as [AccentName, string][]) {
    entries.push({
      id: `accent.${accent}`,
      title: `强调色：${title}`,
      group: "外观",
      // 色块而不是图标：九个色相各配一个相同的小图标等于没给信息。颜色从这个
      // 色相自己的 `--qj-accent` 取（`[data-qj-accent]` 的声明会命中这个元素
      // 本身），所以 theme.css 改色时这里自动跟着变，不必在 JS 里再抄一份。
      icon: <span className="qj-accent-swatch" data-qj-accent={accent} />,
      run: () => settings().update("accent", accent),
    });
  }

  for (const { section, title, icon } of SETTINGS_COMMANDS) {
    entries.push({
      id: `settings.${section}`,
      title,
      group: "设置",
      icon,
      run: () => ui().openSettings(section),
    });
  }

  return entries;
}

export function CommandPalette() {
  const isOpen = useUi((state) => state.isPaletteOpen);
  const setPaletteOpen = useUi((state) => state.setPaletteOpen);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const commands = useMemo(buildEntries, []);
  const results = useMemo(
    () => rankByFuzzy(commands, query, (command) => `${command.title} ${command.group}`),
    [commands, query],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlighted row inside the scroll viewport while arrowing around.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (command: PaletteEntry) => {
    setPaletteOpen(false);
    command.run();
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={setPaletteOpen} variant="blur">
      <Modal.Container size="lg" placement="top">
        <Modal.Dialog className="qj-palette" aria-label="命令面板">
          <div className="border-b border-border/80 p-2">
            <input
              autoFocus
              className="field w-full"
              placeholder="输入命令名称…"
              aria-label="搜索命令"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const command = results[activeIndex];
                  if (command) run(command);
                }
              }}
            />
          </div>

          <ul
            ref={listRef}
            role="listbox"
            aria-label="命令"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {results.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    index === activeIndex
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "hover:bg-default/60",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(command)}
                >
                  <span className="shrink-0 opacity-70">{command.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.shortcut ? (
                    <span className="shrink-0 font-mono text-[11px] text-muted">
                      {command.shortcut}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted">{command.group}</span>
                  )}
                </button>
              </li>
            ))}

            {results.length === 0 && (
              <li className="px-2.5 py-6 text-center text-sm text-muted">没有匹配的命令</li>
            )}
          </ul>

          <div className="flex items-center gap-3 border-t border-border/80 px-3 py-1.5 text-[11px] text-muted">
            <span>↑↓ 选择</span>
            <span>Enter 执行</span>
            <span>Esc 关闭</span>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
