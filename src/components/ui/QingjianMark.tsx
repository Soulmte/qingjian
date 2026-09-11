import { useId } from "react";

/**
 * 青简的标记：一枚圆角方印，中间一个大「简」字，里圈一道发丝线。
 *
 * 字形轮廓是从宋体里抽出来的矢量，直接内联在下面，所以标记不依赖用户机器上
 * 装了什么字体——何况宋体在 macOS / Linux 上未必存在。轮廓、几何与图标由
 * `design/make-logo.py` 统一生成，改版式请改那里再重跑，不要手改这里。
 *
 * 颜色只走 CSS 变量：印底取 `--qj-mark-*`（由强调色派生），印文取
 * `--qj-accent-text`。所以六套强调色 × 明暗两式，标记自动跟随，无需任何 JS。
 */

/* 以下常量与 design/make-logo.py 的 RADIUS / RING_INSET / RING_RADIUS /
   RING_WIDTH / RING_MIN_SIZE 一一对应，改版式请改那边再重跑。 */
const RADIUS = 23.5;
const RING_INSET = 8.5;
const RING_RADIUS = 18.4;
const RING_WIDTH = 0.9;
const RING_OPACITY = 0.38;
/** 再小就不画内圈：阈值的道理与生成器里一样。 */
const RING_MIN_SIZE = 48;

/**
 * 「简」的笔画加粗量，**设计单位**（占方印的百分比）。
 *
 * 宋体笔画太细，48px 下实心占比只有 0.062，看着发灰；描 3 单位的边之后是 0.155。
 * 与 `design/make-logo.py` 的 GLYPH_STROKE 必须一致——图标那边用「沿轮廓描粗线」
 * 实现，两者等价。
 */
export const GLYPH_STROKE = 3.0;

/** 「简」的墨迹高 64/100 方印，按墨迹居中。 */
export const GLYPH_PATH =
  "M44.58 58.95V67.36H55.69V58.95ZM29.93 45.12Q29.93 74.41 30.2 80.1L26.14 82" +
  "Q26.41 69.53 26.41 56.92Q26.41 44.31 26.14 39.97L32.1 42.68ZM31.29 34" +
  "Q37.53 37.25 38.47 38.75Q39.42 40.24 39.42 41.32Q39.42 42.14 38.88 43.22" +
  "Q38.34 44.31 37.25 44.85Q36.17 45.39 35.9 43.49Q35.36 41.86 34.27 39.69" +
  "Q33.19 37.53 30.75 35.08ZM60.03 74.41Q64.92 74.95 66.95 75.08Q68.98 75.22 70.07 74.95" +
  "Q71.15 74.68 71.15 73.05V39.69H50.81Q48.64 39.69 45.66 40.51L43.22 38.07H70.88L73.32 35.63" +
  "L77.12 39.42L74.68 41.05V74.95Q74.68 76.85 73.86 78.34Q73.05 79.83 69.53 81.19" +
  "Q68.44 77.12 60.03 75.49ZM40.78 73.32Q41.05 64.37 41.05 56.51Q41.05 48.64 40.78 45.12" +
  "L44.58 47.56H55.97L57.59 44.85L61.93 48.64L59.22 50.81Q59.22 66.81 59.76 70.07L55.69 71.69" +
  "V68.98H44.58V71.69ZM44.58 49.19V57.32H55.69V49.19ZM36.98 22.07 34.81 22.88 32.1 26.14H44.03" +
  "L47.02 23.15L51.36 27.76H36.71Q40.78 29.66 41.46 31.02Q42.14 32.37 42.14 32.92" +
  "Q42.14 33.46 41.59 34.54Q41.05 35.63 39.97 35.9Q38.88 36.17 38.61 34.27" +
  "Q38.07 32.64 37.39 31.15Q36.71 29.66 35.08 27.76H31.02Q29.12 29.39 26.68 32.1" +
  "Q23.97 35.08 20.44 37.8L19.9 36.98Q23.42 33.19 26.81 28.03Q30.2 22.88 31.83 18Z" +
  "M62.2 21.8 59.76 22.88 57.32 26.14H72.78L75.76 23.15L80.1 27.76H62.2Q67.08 30.2 67.49 31.15" +
  "Q67.9 32.1 67.9 32.64Q67.9 33.19 67.63 33.86Q67.36 34.54 66.68 35.08Q66 35.63 65.73 35.63" +
  "Q65.19 35.63 64.78 34.68Q64.37 33.73 63.83 31.83Q63.29 30.2 61.12 27.76H56.51" +
  "Q52.44 32.1 47.83 35.9L47.02 35.08Q51.08 30.47 53.66 25.73Q56.24 20.98 57.32 18.27Z";

type QingjianMarkProps = {
  /** 边长，像素。48 以下会隐去内圈——那条线在那个尺度只是噪点。 */
  size?: number;
  className?: string;
  /** 单独出现时才给无障碍名；旁边已有「青简」二字时留空，按装饰处理。 */
  label?: string;
};

export function QingjianMark({ size = 44, className, label }: QingjianMarkProps) {
  // useId 会带冒号，塞进 url(#…) 不稳，先洗一遍
  const gradientId = `qj-mark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--qj-mark-top, var(--qj-accent))" }} />
          <stop offset="1" style={{ stopColor: "var(--qj-mark-bottom, var(--qj-accent))" }} />
        </linearGradient>
      </defs>

      <rect width="100" height="100" rx={RADIUS} fill={`url(#${gradientId})`} />
      {size >= RING_MIN_SIZE && (
        <rect
          x={RING_INSET}
          y={RING_INSET}
          width={100 - RING_INSET * 2}
          height={100 - RING_INSET * 2}
          rx={RING_RADIUS}
          fill="none"
          stroke="var(--qj-accent-text)"
          strokeOpacity={RING_OPACITY}
          // 线宽取「几何宽度」与一个 CSS 像素的较大值：亚像素的线渲染出来
          // 是一圈灰晕，那正是「模糊」的来源。100/size 恰好等于 1 个 CSS 像素。
          strokeWidth={Math.max(100 / size, RING_WIDTH)}
        />
      )}
      <path
        d={GLYPH_PATH}
        fill="var(--qj-accent-text)"
        stroke="var(--qj-accent-text)"
        strokeWidth={GLYPH_STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}
