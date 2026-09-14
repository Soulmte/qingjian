import {
  FontPicker,
  OptionCard,
  OptionGrid,
  RangeField,
  SettingGroup,
  SettingRow,
} from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { useSystemFonts } from "@/components/settings/use-system-fonts";
import { isLightCodeBackground } from "@/lib/code-theme";
import { fontStack, MONO_FONT_FALLBACK } from "@/lib/fonts";
import { CODE_BACKGROUNDS } from "@/stores/settings";
import type { CodeBackgroundName } from "@/types";

const CODE_BACKGROUND_LABELS: Record<CodeBackgroundName, string> = {
  cloud: "云白",
  sand: "暖沙",
  celadon: "青瓷",
  graphite: "石墨",
  jade: "墨玉",
  space: "深空",
};

export function CodeSection() {
  const [codeBackground, setCodeBackground] = useSetting("codeBackground");
  const [codeFont, setCodeFont] = useSetting("codeFont");
  const [codeFontSize, setCodeFontSize] = useSetting("codeFontSize");

  const fonts = useSystemFonts();

  const lightOnes = CODE_BACKGROUNDS.filter(isLightCodeBackground);
  const darkOnes = CODE_BACKGROUNDS.filter((name) => !isLightCodeBackground(name));

  const renderCard = (name: CodeBackgroundName) => (
    <OptionCard
      key={name}
      selected={codeBackground === name}
      onSelect={() => setCodeBackground(name)}
      label={CODE_BACKGROUND_LABELS[name]}
    >
      {/* data-qj-codebg makes the swatch use the real palette, and doubles as
          the live preview of what a code block will look like. */}
      <div
        data-qj-codebg={name}
        className="w-full rounded-lg border px-2.5 py-2"
        style={{ background: "var(--qj-code-bg)", borderColor: "var(--qj-code-border)" }}
      >
        <span
          className="mb-1.5 block text-[10px] leading-none"
          style={{ color: "var(--qj-code-ln)" }}
        >
          1
        </span>
        <span
          className="block h-1.5 w-3/4 rounded-full"
          style={{ background: "var(--qj-code-text)", opacity: 0.75 }}
        />
        <span
          className="mt-1.5 block h-1.5 w-1/2 rounded-full"
          style={{ background: "var(--qj-code-ln)" }}
        />
      </div>
    </OptionCard>
  );

  return (
    <>
      <SettingGroup title="代码块背景">
        <SettingRow label="亮色" hint="与明暗模式无关，六个背景可以任意搭配" stacked>
          <OptionGrid>{lightOnes.map(renderCard)}</OptionGrid>
        </SettingRow>
        <SettingRow label="暗色" stacked>
          <OptionGrid>{darkOnes.map(renderCard)}</OptionGrid>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="等宽字体">
        <SettingRow
          label="字体族"
          hint={`仅列出本机等宽字体（${fonts.filter((font) => font.monospace).length} 个）`}
        >
          <FontPicker
            ariaLabel="代码字体"
            value={codeFont}
            onChange={setCodeFont}
            fonts={fonts}
            defaultLabel="内置等宽栈"
            monospaceOnly
          />
        </SettingRow>
        <SettingRow label="代码字号">
          <RangeField
            ariaLabel="代码字号"
            value={codeFontSize}
            min={11}
            max={20}
            onChange={setCodeFontSize}
            unit="px"
          />
        </SettingRow>
        <SettingRow label="预览" stacked>
          <div
            data-qj-codebg={codeBackground}
            className="rounded-lg border px-3 py-2.5"
            style={{ background: "var(--qj-code-bg)", borderColor: "var(--qj-code-border)" }}
          >
            <pre
              className="m-0 overflow-x-auto"
              style={{
                color: "var(--qj-code-text)",
                fontFamily: fontStack(codeFont, MONO_FONT_FALLBACK),
                fontSize: `${codeFontSize}px`,
                lineHeight: 1.6,
              }}
            >
              <code>{'fn main() { println!("青简"); }'}</code>
            </pre>
          </div>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
