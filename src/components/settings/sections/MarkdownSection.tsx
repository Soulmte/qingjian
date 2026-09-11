import { SettingGroup, SettingRow, Toggle } from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";

export function MarkdownSection() {
  const [mathEnabled, setMathEnabled] = useSetting("mathEnabled");
  const [tableEnabled, setTableEnabled] = useSetting("tableEnabled");
  const [codeHighlightEnabled, setCodeHighlightEnabled] = useSetting("codeHighlightEnabled");
  const [linkTooltipEnabled, setLinkTooltipEnabled] = useSetting("linkTooltipEnabled");
  const [blockHandleEnabled, setBlockHandleEnabled] = useSetting("blockHandleEnabled");

  return (
    <>
      <SettingGroup title="语法支持">
        <SettingRow label="数学公式" hint="支持行内 $…$ 与块级 $$…$$，由 KaTeX 渲染">
          <Toggle ariaLabel="数学公式" checked={mathEnabled} onChange={setMathEnabled} />
        </SettingRow>
        <SettingRow label="表格" hint="启用 GFM 表格，可在单元格内直接编辑">
          <Toggle ariaLabel="表格" checked={tableEnabled} onChange={setTableEnabled} />
        </SettingRow>
        <SettingRow label="代码语法高亮" hint="关闭后代码块退化为纯文本，其它功能不受影响">
          <Toggle
            ariaLabel="代码语法高亮"
            checked={codeHighlightEnabled}
            onChange={setCodeHighlightEnabled}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="编辑辅助">
        <SettingRow label="链接悬浮提示" hint="点击链接时显示编辑与打开入口">
          <Toggle
            ariaLabel="链接悬浮提示"
            checked={linkTooltipEnabled}
            onChange={setLinkTooltipEnabled}
          />
        </SettingRow>
        <SettingRow label="块拖拽手柄" hint="悬停段落左侧时出现手柄与斜杠菜单">
          <Toggle
            ariaLabel="块拖拽手柄"
            checked={blockHandleEnabled}
            onChange={setBlockHandleEnabled}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
