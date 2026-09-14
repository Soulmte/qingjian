import { useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "@/lib/api";
import { parseMarkdown } from "@/lib/export/ir";
import { exportStylePayload } from "@/lib/export/styles";
import { SECTION_KEYS } from "@/lib/settings-sections";
import { useSettings } from "@/stores/settings";
import type { AppSettings } from "@/types";

/**
 * The export preview.
 *
 * Every other page in the settings can be judged by looking at the app, but the
 * export styles can only be judged by exporting something — so this renders the
 * real thing: the same sample note goes through the same parser, the same style
 * payload and the same renderer the 导出 button uses, and the result is shown in
 * a frame. What you see here is what the file will contain.
 *
 * A misspelt number is far more obvious next to its result, which is the whole
 * point: previously the only way to check a heading size was to export a
 * document and open it in Word.
 */

/** Page sizes in millimetres, matching the renderer's own table. */
const PAGE_MM: Record<string, [number, number]> = {
  a4: [210, 297],
  letter: [216, 279],
};
const MM_TO_PX = 96 / 25.4;
/** The width the page is scaled down to. */
const PREVIEW_WIDTH = 528;
/** How much of the page is visible before the frame scrolls. */
const PREVIEW_HEIGHT = 330;
/** Re-render delay, so dragging a slider does not render per step. */
const RENDER_DELAY = 250;

/** The sample: one of everything the styles touch. */
const SAMPLE = `# 一级标题

正文段落，用来判断字号与行距；含 **加粗**、*斜体*、\`行内代码\` 和 [链接](https://example.com)。

## 二级标题

- 无序列表项
- 第二项

1. 有序列表项
2. 第二项

> 引用段落，用来判断缩进与边线。

\`\`\`js
const answer = 42;
\`\`\`

| 列 A | 列 B |
| --- | --- |
| 单元格 | 内容 |

---

尾段。
`;

export function ExportPreview() {
  const settings = useSettings((state) => state.settings);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  const blocks = useMemo(() => parseMarkdown(SAMPLE), []);

  /**
   * The effect below must not re-run for a setting the export does not use —
   * 圆角, say — so it watches exactly the keys the 导出 page owns.
   */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const styleKey = useMemo(
    () =>
      JSON.stringify(
        SECTION_KEYS.export.map((key) => settings[key as keyof AppSettings]),
      ),
    [settings],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void api
        .renderExport({
          blocks,
          styles: exportStylePayload(settingsRef.current, "青简导出预览"),
        })
        .then((next) => {
          setHtml(next);
          setError(null);
        })
        .catch((problem) => setError(errorMessage(problem)));
    }, RENDER_DELAY);

    return () => clearTimeout(timer);
  }, [blocks, styleKey]);

  const [pageWidth, pageHeight] = PAGE_MM[settings.exportPageSize] ?? PAGE_MM.a4;
  const widthPx = pageWidth * MM_TO_PX;
  const scale = PREVIEW_WIDTH / widthPx;

  return (
    <section className="mb-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">预览</h3>
        <span className="text-[11px] text-muted tabular-nums">
          {`${settings.exportPageSize.toUpperCase()} ${pageWidth}×${pageHeight}mm · 页边距 ${settings.exportMarginTop}/${settings.exportMarginRight}/${settings.exportMarginBottom}/${settings.exportMarginLeft}mm`}
        </span>
      </div>

      <div
        className="qj-export-preview"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
      >
        {error ? (
          <p className="p-4 text-xs text-danger">{`预览渲染失败：${error}`}</p>
        ) : html ? (
          <iframe
            title="导出预览"
            // No scripts, no same-origin: the renderer only produces markup, and
            // a preview has no business running anything.
            sandbox=""
            srcDoc={html}
            style={{
              width: widthPx,
              height: PREVIEW_HEIGHT / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        ) : (
          <p className="p-4 text-xs text-muted">正在渲染预览…</p>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {`预览用的是导出时同一套排版：字体、字号、标题阶梯、代码底色、表格与页边距都会体现在里面（纸张按比例缩小到 ${Math.round(scale * 100)}%）。`}
      </p>
    </section>
  );
}
