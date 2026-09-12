import { Monitor, Moon, Sun } from "lucide-react";

import {
  FontPicker,
  OptionCard,
  OptionGrid,
  RangeField,
  SegmentedControl,
  SettingGroup,
  SettingRow,
} from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { useSystemFonts } from "@/components/settings/use-system-fonts";
import { fontStack, UI_FONT_FALLBACK } from "@/lib/fonts";
import { ACCENTS } from "@/stores/settings";
import type { AccentName, ThemeMode } from "@/types";

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
 * 一句话说明就用色本身，不再描述「纸面偏冷/偏暖」。
 *
 * 强调色在画布上的占比已经收到 2% 上下，纸面几乎不变色；旧提示词描述的是那个
 * 早已不存在的效果，会让人以为选错主题了。
 */
const ACCENT_HINTS: Record<AccentName, string> = {
  bamboo: "草木绿，竹简本色",
  ink: "砚台蓝，沉静冷调",
  rouge: "胭脂红，暖而不艳",
  ochre: "赭土橘，陶器质感",
  violet: "黛紫罗，冷调紫韵",
  teal: "苍碧青，水色微青",
  mono: "墨白，无色相的中性",
  gamboge: "藤黄，颜料金",
  idea: "JetBrains New UI 蓝",
};

const MODE_LABELS: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function AppearanceSection() {
  const [theme, setTheme] = useSetting("theme");
  const [accent, setAccent] = useSetting("accent");
  const [uiFont, setUiFont] = useSetting("uiFont");
  const [radius, setRadius] = useSetting("radius");

  const fonts = useSystemFonts();

  return (
    <>
      <SettingGroup title="明暗">
        <SettingRow label="外观模式" hint="跟随系统时会自动响应操作系统的深浅色切换">
          <SegmentedControl<ThemeMode>
            ariaLabel="外观模式"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "浅色", swatch: <Sun className="size-3.5" /> },
              { value: "dark", label: "深色", swatch: <Moon className="size-3.5" /> },
              { value: "system", label: "跟随系统", swatch: <Monitor className="size-3.5" /> },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="主题">
        <SettingRow
          label="主题色"
          hint="强调色用在当前项、焦点环、主操作与链接上；画布只沾一点它的色相"
          stacked
        >
          <p className="mb-2.5 text-xs text-muted">
            当前主题：{ACCENT_LABELS[accent]} · {MODE_LABELS[theme]}
          </p>

          <OptionGrid>
            {ACCENTS.map((name) => (
              <OptionCard
                key={name}
                selected={accent === name}
                onSelect={() => setAccent(name)}
                label={ACCENT_LABELS[name]}
              >
                {/* Each preview carries its own `data-qj-accent`, and
                    `theme.css` re-derives the paper palette inside it, so this
                    shows the real result rather than a colour chip. */}
                <div data-qj-accent={name} className="qj-theme-preview">
                  <span className="qj-theme-preview__sidebar" />
                  <div className="qj-theme-preview__main">
                    <span className="qj-theme-preview__toolbar" />
                    <span className="qj-theme-preview__paper">
                      <span className="qj-theme-preview__line" />
                      <span className="qj-theme-preview__line qj-theme-preview__line--short" />
                      <span className="qj-theme-preview__accent" />
                    </span>
                  </div>
                </div>
                <span className="text-[11px] leading-tight text-muted">
                  {ACCENT_HINTS[name]}
                </span>
              </OptionCard>
            ))}
          </OptionGrid>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="界面">
        <SettingRow label="界面字体" hint={`从本机读取，共 ${fonts.length} 个字体族`}>
          <FontPicker
            ariaLabel="界面字体"
            value={uiFont}
            onChange={setUiFont}
            fonts={fonts}
            defaultLabel="跟随系统默认"
          />
        </SettingRow>
        <SettingRow
          label="预览"
          hint="拉丁字母用所选字体；字体缺的字形（多数西文字体没有汉字）由系统字体补全"
          stacked
        >
          <div
            className="rounded-lg border border-border/80 bg-default/30 px-3 py-2.5 text-sm"
            style={{ fontFamily: fontStack(uiFont, UI_FONT_FALLBACK) }}
          >
            青简 Qingjian · 永和九年 Aa 0123 —— 编码之外，留一处安静写字的地方。
          </div>
        </SettingRow>
        <SettingRow label="圆角" hint="作用于按钮、输入框与卡片">
          <RangeField
            ariaLabel="圆角"
            value={radius}
            min={8}
            max={20}
            onChange={setRadius}
            format={(value) => `${value} px`}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
