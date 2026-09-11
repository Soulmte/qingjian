import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GLYPH_PATH, GLYPH_STROKE, QingjianMark } from "./QingjianMark";

/**
 * 标记的字形轮廓是 `design/make-logo.py` 抽出来再贴进组件的死字符串，最容易
 * 出问题的地方是「重新生成了一半」——比如改了脚本、重跑了图标，却忘了更新
 * 组件。这里把组件与 favicon 两条产物钉在一起，谁掉队都会被骂。
 */
describe("QingjianMark", () => {
  it("轮廓是一条合法的 SVG 路径", () => {
    expect(GLYPH_PATH.startsWith("M")).toBe(true);
    expect(GLYPH_PATH.endsWith("Z")).toBe(true);
    // 只允许路径命令与数字，出现别的字符说明粘贴时混进了东西
    expect(GLYPH_PATH).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.\-\s]+$/);
  });

  it("轮廓落在方印之内", () => {
    const numbers = GLYPH_PATH.match(/-?\d+(\.\d+)?/g) ?? [];
    const coords = numbers.map(Number);
    expect(coords.length).toBeGreaterThan(100);
    for (const value of coords) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("与 public/qingjian.svg 里的轮廓一致", () => {
    const svg = readFileSync(
      fileURLToPath(new URL("../../../public/qingjian.svg", import.meta.url)),
      "utf8",
    );
    const match = svg.match(/<path d="([^"]+)"/);
    expect(match).not.toBeNull();
    const strip = (value: string) => value.replace(/\s+/g, "");
    expect(strip(GLYPH_PATH)).toBe(strip(match![1]));
  });

  it("渲染出方印、发丝内圈与「简」，颜色全部走主题变量", () => {
    const html = renderToStaticMarkup(createElement(QingjianMark, { size: 48 }));

    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toContain('width="48"');
    // 渐变两端的颜色必须来自主题，否则换强调色时标记不会跟着变
    expect(html).toContain("var(--qj-mark-top");
    expect(html).toContain("var(--qj-mark-bottom");
    expect(html).toContain("fill=\"var(--qj-accent-text)\"");
    // 文字说明就在旁边，标记本身应当对读屏软件隐形
    expect(html).toContain('aria-hidden="true"');

    // 两处描边：内圈（先）与字形（后）
    const widths = [...html.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(2);
    // 内圈不得小于一个 CSS 像素（100 视口单位 / 48px 就是 1 个 CSS 像素），
    // 亚像素的线渲染出来只是一圈灰晕
    expect(widths[0]).toBeCloseTo(100 / 48, 3);
    // 字形描边是设计单位，与生成器里的 GLYPH_STROKE 必须同值
    expect(widths[1]).toBeCloseTo(GLYPH_STROKE, 3);
  });

  it("小尺寸下不画内圈，但字仍然描边", () => {
    const html = renderToStaticMarkup(createElement(QingjianMark, { size: 32 }));
    expect(html).not.toContain("stroke-opacity");

    const widths = [...html.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(1);
    expect(widths[0]).toBeCloseTo(GLYPH_STROKE, 3);
  });
});
