import {
  FontPicker,
  RangeField,
  SettingGroup,
  SettingRow,
  Toggle,
} from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { useSystemFonts } from "@/components/settings/use-system-fonts";
import { fontStack, UI_FONT_FALLBACK } from "@/lib/fonts";

/** Sample text rendered in the font the picker would apply. */
const SAMPLE = "青简 Markdown —— 编码之外，留一处安静写字的地方。";

export function EditorSection() {
  const [fontSize, setFontSize] = useSetting("fontSize");
  const [lineHeight, setLineHeight] = useSetting("lineHeight");
  const [editorWidth, setEditorWidth] = useSetting("editorWidth");
  const [editorFont, setEditorFont] = useSetting("editorFont");
  const [spellCheck, setSpellCheck] = useSetting("spellCheck");
  const [focusMode, setFocusMode] = useSetting("focusMode");
  const [typewriterMode, setTypewriterMode] = useSetting("typewriterMode");

  const fonts = useSystemFonts();

  return (
    <>
      <SettingGroup title="排版">
        <SettingRow label="正文字号" hint="标题与代码会按比例缩放">
          <RangeField
            ariaLabel="正文字号"
            value={fontSize}
            min={12}
            max={24}
            onChange={setFontSize}
            unit="px"
          />
        </SettingRow>
        <SettingRow label="行高" hint="作用于正文、列表、表格与引用；标题保留自己的紧凑行距">
          <RangeField
            ariaLabel="行高"
            value={lineHeight}
            min={1.3}
            max={2.4}
            step={0.05}
            onChange={setLineHeight}
            unit=""
          />
        </SettingRow>
        <SettingRow label="正文宽度" hint="书写区域的列宽上限，过大时换行会变得吃力">
          <RangeField
            ariaLabel="正文宽度"
            value={editorWidth}
            min={560}
            max={1400}
            step={20}
            onChange={setEditorWidth}
            unit="px"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="正文字体">
        <SettingRow label="字体族" hint="从本机读取">
          <FontPicker
            ariaLabel="正文字体"
            value={editorFont}
            onChange={setEditorFont}
            fonts={fonts}
            defaultLabel="跟随界面字体"
          />
        </SettingRow>
        <SettingRow
          label="预览"
          hint="拉丁字母用所选字体；字体缺的字形（多数西文字体没有汉字）由系统字体补全"
          stacked
        >
          <div
            className="rounded-lg border border-border/80 bg-default/30 px-3 py-2.5 text-sm"
            style={{
              fontFamily: fontStack(editorFont, UI_FONT_FALLBACK),
              lineHeight,
            }}
          >
            {SAMPLE}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="校对">
        <SettingRow label="拼写检查" hint="使用系统拼写词典，仅对英文生效">
          <Toggle ariaLabel="拼写检查" checked={spellCheck} onChange={setSpellCheck} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="沉浸写作">
        <SettingRow label="专注模式" hint="只高亮光标所在段落，其余内容淡化（F8）">
          <Toggle ariaLabel="专注模式" checked={focusMode} onChange={setFocusMode} />
        </SettingRow>
        <SettingRow label="打字机模式" hint="光标所在行始终停在视口中央（F9）">
          <Toggle ariaLabel="打字机模式" checked={typewriterMode} onChange={setTypewriterMode} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
