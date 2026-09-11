import {
  FontPicker,
  RangeField,
  SegmentedControl,
  SettingGroup,
  SettingRow,
  TextField,
  Toggle,
} from "@/components/settings/controls";
import { useSetting } from "@/components/settings/use-setting";
import { useSystemFonts } from "@/components/settings/use-system-fonts";
import type { ExportFormat, ExportPageSize } from "@/types";

/** Level names, so the six point-size boxes read as a hierarchy. */
const LEVEL_LABELS = ["一级", "二级", "三级", "四级", "五级", "六级"];

/**
 * The six heading sizes, one box each.
 *
 * Separate boxes rather than a single "scale" control because the mapping is the
 * point: a document often wants 22pt for level one and 12pt for level six, and
 * no ratio produces that. The labels mark them as a descending chain.
 */
function HeadingSizes({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {LEVEL_LABELS.map((label, index) => (
        <label key={label} className="flex flex-col items-center gap-1">
          <input
            type="number"
            min={8}
            max={48}
            step={1}
            aria-label={`${label}标题字号（磅）`}
            className="field w-14 text-center"
            value={value[index]}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              const sizes = [...value];
              sizes[index] = Math.min(48, Math.max(8, Math.round(next)));
              onChange(sizes);
            }}
          />
          <span className="text-[11px] text-muted">{label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Export appearance.
 *
 * Everything a printed or Word document needs to look like itself: the page,
 * the body text, and — level by level — what a heading becomes. Word's built-in
 * `Heading 1`…`Heading 6` styles carry exactly these values, so the mapping here
 * is what shows up in Word's style list and its navigation pane.
 */
export function ExportSection() {
  const fonts = useSystemFonts();

  const [format, setFormat] = useSetting("exportFormat");
  const [includeTitle, setIncludeTitle] = useSetting("exportIncludeTitle");

  const [pageSize, setPageSize] = useSetting("exportPageSize");
  const [marginTop, setMarginTop] = useSetting("exportMarginTop");
  const [marginBottom, setMarginBottom] = useSetting("exportMarginBottom");
  const [marginLeft, setMarginLeft] = useSetting("exportMarginLeft");
  const [marginRight, setMarginRight] = useSetting("exportMarginRight");

  const [bodyFont, setBodyFont] = useSetting("exportBodyFont");
  const [bodyFontSize, setBodyFontSize] = useSetting("exportBodyFontSize");
  const [bodyLineHeight, setBodyLineHeight] = useSetting("exportBodyLineHeight");

  const [headingFont, setHeadingFont] = useSetting("exportHeadingFont");
  const [headingBold, setHeadingBold] = useSetting("exportHeadingBold");
  const [headingColor, setHeadingColor] = useSetting("exportHeadingColor");
  const [headingSizes, setHeadingSizes] = useSetting("exportHeadingSizes");
  const [headingSpaceBefore, setHeadingSpaceBefore] = useSetting("exportHeadingSpaceBefore");
  const [headingSpaceAfter, setHeadingSpaceAfter] = useSetting("exportHeadingSpaceAfter");

  const [codeFont, setCodeFont] = useSetting("exportCodeFont");
  const [codeFontSize, setCodeFontSize] = useSetting("exportCodeFontSize");
  const [codeBackground, setCodeBackground] = useSetting("exportCodeBackground");

  const [tableBorders, setTableBorders] = useSetting("exportTableBorders");
  const [tableHeaderFill, setTableHeaderFill] = useSetting("exportTableHeaderFill");
  const [imageMaxWidth, setImageMaxWidth] = useSetting("exportImageMaxWidth");

  return (
    <>
      <SettingGroup title="导出方式">
        <SettingRow
          label="默认格式"
          hint="「导出」对话框里默认选中的格式；改成别的扩展名也会按扩展名输出"
        >
          <SegmentedControl<ExportFormat>
            ariaLabel="默认导出格式"
            value={format}
            onChange={setFormat}
            options={[
              { value: "docx", label: "Word" },
              { value: "pdf", label: "PDF" },
              { value: "html", label: "网页" },
              { value: "txt", label: "纯文本" },
              { value: "md", label: "Markdown" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="写入标题"
          hint="把笔记标题作为文档的第一个一级标题写在正文之前"
        >
          <Toggle ariaLabel="写入标题" checked={includeTitle} onChange={setIncludeTitle} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="页面">
        <SettingRow label="纸张">
          <SegmentedControl<ExportPageSize>
            ariaLabel="纸张大小"
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: "Letter" },
            ]}
          />
        </SettingRow>

        <SettingRow label="页边距" hint="上下左右，单位毫米">
          <div className="flex flex-wrap items-center gap-3">
            <RangeField
              ariaLabel="上边距"
              value={marginTop}
              min={5}
              max={60}
              onChange={setMarginTop}
              format={(value) => `${value} mm`}
            />
            <RangeField
              ariaLabel="下边距"
              value={marginBottom}
              min={5}
              max={60}
              onChange={setMarginBottom}
              format={(value) => `${value} mm`}
            />
          </div>
        </SettingRow>

        <SettingRow label="左右边距" hint="上下左右，单位毫米">
          <div className="flex flex-wrap items-center gap-3">
            <RangeField
              ariaLabel="左边距"
              value={marginLeft}
              min={5}
              max={60}
              onChange={setMarginLeft}
              format={(value) => `${value} mm`}
            />
            <RangeField
              ariaLabel="右边距"
              value={marginRight}
              min={5}
              max={60}
              onChange={setMarginRight}
              format={(value) => `${value} mm`}
            />
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="正文">
        <SettingRow label="字体" hint="留空则跟随编辑器正文字体">
          <FontPicker
            ariaLabel="导出正文字体"
            value={bodyFont}
            onChange={setBodyFont}
            fonts={fonts}
            defaultLabel="跟随编辑器"
          />
        </SettingRow>

        <SettingRow label="字号">
          <RangeField
            ariaLabel="导出正文字号"
            value={bodyFontSize}
            min={8}
            max={24}
            onChange={setBodyFontSize}
            format={(value) => `${value} pt`}
          />
        </SettingRow>

        <SettingRow label="行距">
          <RangeField
            ariaLabel="导出行距"
            value={bodyLineHeight}
            min={1.1}
            max={2.6}
            step={0.05}
            onChange={setBodyLineHeight}
            format={(value) => `${value.toFixed(2)} 倍`}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="标题">
        <SettingRow
          label="各级字号"
          hint="对应 Word 的「标题 1」到「标题 6」样式，单位磅"
          stacked
        >
          <HeadingSizes value={headingSizes} onChange={setHeadingSizes} />
        </SettingRow>

        <SettingRow label="字体" hint="留空则跟随正文字体">
          <FontPicker
            ariaLabel="导出标题字体"
            value={headingFont}
            onChange={setHeadingFont}
            fonts={fonts}
            defaultLabel="跟随正文"
          />
        </SettingRow>

        <SettingRow label="加粗">
          <Toggle ariaLabel="标题加粗" checked={headingBold} onChange={setHeadingBold} />
        </SettingRow>

        <SettingRow label="颜色" hint="形如 #1a1a1a；留空使用默认色">
          <TextField
            ariaLabel="标题颜色"
            value={headingColor}
            onChange={setHeadingColor}
            placeholder="#1a1a1a"
            className="w-32"
          />
        </SettingRow>

        <SettingRow label="段前间距" hint="一级标题的值；更低的级别按比例递减">
          <RangeField
            ariaLabel="标题段前间距"
            value={headingSpaceBefore}
            min={0}
            max={60}
            onChange={setHeadingSpaceBefore}
            format={(value) => `${value} pt`}
          />
        </SettingRow>

        <SettingRow label="段后间距">
          <RangeField
            ariaLabel="标题段后间距"
            value={headingSpaceAfter}
            min={0}
            max={60}
            onChange={setHeadingSpaceAfter}
            format={(value) => `${value} pt`}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="代码">
        <SettingRow label="字体" hint="留空则跟随编辑器代码字体">
          <FontPicker
            ariaLabel="导出代码字体"
            value={codeFont}
            onChange={setCodeFont}
            fonts={fonts}
            defaultLabel="跟随编辑器"
            monospaceOnly
          />
        </SettingRow>

        <SettingRow label="字号">
          <RangeField
            ariaLabel="导出代码字号"
            value={codeFontSize}
            min={7}
            max={20}
            onChange={setCodeFontSize}
            format={(value) => `${value} pt`}
          />
        </SettingRow>

        <SettingRow label="底色" hint="形如 #f5f5f5；留空使用默认浅灰">
          <TextField
            ariaLabel="代码底色"
            value={codeBackground}
            onChange={setCodeBackground}
            placeholder="#f5f5f5"
            className="w-32"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="表格与图片">
        <SettingRow label="表格边框">
          <Toggle
            ariaLabel="表格边框"
            checked={tableBorders}
            onChange={setTableBorders}
          />
        </SettingRow>

        <SettingRow label="表头底色" hint="形如 #f2f2f2；留空使用默认浅灰">
          <TextField
            ariaLabel="表头底色"
            value={tableHeaderFill}
            onChange={setTableHeaderFill}
            placeholder="#f2f2f2"
            className="w-32"
          />
        </SettingRow>

        <SettingRow label="图片最大宽度" hint="占正文宽度的百分比">
          <RangeField
            ariaLabel="导出图片最大宽度"
            value={imageMaxWidth}
            min={20}
            max={100}
            onChange={setImageMaxWidth}
            format={(value) => `${value}%`}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
