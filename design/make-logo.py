#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""青简（qingjian）品牌标记生成器。

标记 = 圆角方印 + 白色「简」字 + 一道内圈发丝边。

这个脚本是标记的**唯一真源**：

  --path   打印归一化后的 SVG path，贴进 src/components/ui/QingjianMark.tsx
  --svg    写 public/qingjian.svg（浏览器标签页图标）
  --icons  写 src-tauri/icons/ 全套（PNG / ICO / ICNS）
  --check  自检：确认 path 与字体字形一致、图标文件尺寸正确

改版式只改下面「几何」一节的常量，然后重跑。

依赖（只在生成时需要，运行时不依赖）：

    pip install fonttools pillow

字体默认取 Windows 的 SimSun（宋体），因为「简」在宋体里横细竖粗、
笔画对比强，压在方印上最像「刻」出来的。换字体用 QJ_LOGO_FONT 环境变量，
或加 --font。字形的矢量轮廓会被抽出来内联，所以最终产物不依赖任何字体。
"""

from __future__ import annotations

import argparse
import os
import re
import sys

try:
    from fontTools.misc.transform import Transform
    from fontTools.pens.basePen import BasePen
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover
    sys.exit("缺少 fontTools：pip install fonttools")

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit("缺少 pillow：pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# 几何：全部是 100×100 视口里的绝对单位，改这里就是改版式
# --------------------------------------------------------------------------

TILE = 100.0  # 方印边长
RADIUS = 23.5  # 方印圆角
RING_INSET = 8.5  # 内圈离边距离
RING_RADIUS = RADIUS - RING_INSET * 0.6  # 内圈圆角，比外圈收一点才同心
RING_WIDTH = 0.9  # 发丝线宽，占边长比例
RING_MIN_SIZE = 48  # 再小就不画内圈了：亚像素的线只会变成一圈灰晕
RING_ALPHA = 0.38  # 发丝透明度，再高就抢字了
GLYPH_INK = 64.0  # 「简」的墨迹高度，占方印 64%——「大简字」的分量在这
GLYPH_CHAR = "简"

# 笔画加粗量，**设计单位**（占方印的百分比），不是设备像素。
#
# 这一点很关键：Windows 的任务栏图标来自**一张** 256 的位图（Tauri 把 ICO 的
# 第一个条目当运行时窗口图标，系统再按需缩放），所以加粗量必须在设计单位里定，
# 下采样到 48px 时才能得到同一个分量。按设备像素加粗的话，256 那张图看不出差别。
#
# 宋体的「简」笔画太细：48px 下实心占比只有 0.062，看着发灰。取 3.0 后是 0.145。
# 数值是与 character art 对过之后定的——2.5 偏文气，3.5 开始挤字腔。
GLYPH_STROKE = 3.0

# --------------------------------------------------------------------------
# 调色：与 src/styles/theme.css 的竹青一致
# --------------------------------------------------------------------------

ACCENT = "#4a7c59"  # --qj-accent
GLYPH = "#ffffff"  # --qj-accent-text
TOP_MIX = 0.12  # 顶面往白里混
BOTTOM_MIX = 0.08  # 底面往黑里混

FONT_CANDIDATES = [
    os.environ.get("QJ_LOGO_FONT", ""),
    r"C:\Windows\Fonts\simsun.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
]

ICON_DIR = os.path.join(ROOT, "src-tauri", "icons")

# 文件名 → 边长，保持与 Tauri 脚手架一致
PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "StoreLogo.png": 50,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
}

# **从大到小**：Tauri 的 tauri-codegen 取 ICO 的**第一个**条目当运行时窗口图标
# （`icon_dir.entries()[0]`），Windows 再拿它按需缩放。第一个条目若是 16×16，
# 任务栏就得到一张放大三倍的模糊图——这正是之前「logo 极其模糊」的真因。
# Windows 自己选帧与顺序无关，所以从大到小写是安全的。
# **从大到小**：Tauri 的 tauri-codegen 取 ICO 的**第一个**条目当运行时窗口图标
# （`icon_dir.entries()[0]`），Windows 再拿它按需缩放。第一个条目若是 16×16，
# 任务栏就得到一张放大三倍的模糊图——这正是之前「logo 极其模糊」的真因。
# Windows 自己选帧与顺序无关，所以从大到小写是安全的。
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


# --------------------------------------------------------------------------
# 颜色
# --------------------------------------------------------------------------


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t: float):
    """按 t 混合两组 sRGB 分量。与 CSS 的 color-mix(in srgb, …) 结果一致。"""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def tint(rgb, alpha: float) -> tuple[int, int, int, int]:
    return (rgb[0], rgb[1], rgb[2], max(0, min(255, round(alpha * 255))))


# --------------------------------------------------------------------------
# 字形 → 轮廓
# --------------------------------------------------------------------------


def pick_font(explicit: str | None) -> str:
    for candidate in [explicit or ""] + FONT_CANDIDATES:
        if candidate and os.path.exists(candidate):
            return candidate
    sys.exit("找不到可用字体，用 --font 指定一个")


def load_glyph(font_path: str, char: str):
    font = TTFont(font_path, fontNumber=0)
    glyph_set = font.getGlyphSet()
    name = font.getBestCmap().get(ord(char))
    if name is None:
        sys.exit(f"{os.path.basename(font_path)} 里没有「{char}」")
    bounds_pen = BoundsPen(glyph_set)
    glyph_set[name].draw(bounds_pen)
    if bounds_pen.bounds is None:
        sys.exit(f"「{char}」没有矢量轮廓，换一个字体")
    return glyph_set, name, bounds_pen.bounds


def glyph_transform(bounds) -> tuple[float, float, float]:
    """字体坐标系（y 向上）→ 方印坐标系（y 向下），按**墨迹**居中。

    按墨迹而不是按字身框居中，才能保证观感上的正中——汉字的字身框四周
    留白并不对称。
    """
    x0, y0, x1, y1 = bounds
    scale = GLYPH_INK / (y1 - y0)
    tx = TILE / 2 - scale * (x1 - x0) / 2 - scale * x0
    ty = TILE / 2 - GLYPH_INK / 2 + scale * y1
    return scale, tx, ty


def format_number(value: float, digits: int = 2) -> str:
    """两位小数足够（0.01 单位 ≈ 512px 下的 0.05px），但能把 path 压掉一半。"""
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-") else text


def glyph_path(glyph_set, name, scale, tx, ty) -> str:
    pen = SVGPathPen(glyph_set, ntos=format_number)
    glyph_set[name].draw(TransformPen(pen, Transform(scale, 0, 0, -scale, tx, ty)))
    return pen.getCommands()


class FlattenPen(BasePen):
    """把字形轮廓压成折线，供自己写的扫描线填充使用。

    之所以不直接用 PIL 的字体渲染：标识必须与 TSX 里那条 <path> 逐像素同源，
    否则改版式时两边会悄悄跑偏。
    """

    def __init__(self, glyph_set, steps: int):
        super().__init__(glyph_set)
        self.steps = steps
        self.contours: list[list[tuple[float, float]]] = []
        self._open: list[tuple[float, float]] = []

    def _moveTo(self, pt):
        self._open = [pt]
        self.contours.append(self._open)

    def _lineTo(self, pt):
        self._open.append(pt)

    def _qCurveToOne(self, p1, p2):
        p0 = self._open[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self._open.append(
                (
                    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
                )
            )

    def _curveToOne(self, p1, p2, p3):
        p0 = self._open[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self._open.append(
                (
                    u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                    u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
                )
            )


def glyph_polygons(glyph_set, name, scale, tx, ty, steps: int = 14):
    pen = FlattenPen(glyph_set, steps)
    glyph_set[name].draw(pen)
    return [
        [(px * scale + tx, -py * scale + ty) for (px, py) in contour]
        for contour in pen.contours
    ]


# --------------------------------------------------------------------------
# 光栅化
# --------------------------------------------------------------------------


_MARK_CACHE: dict[int, Image.Image] = {}


def fill_mask(polygons, dim: int):
    """非零环绕规则的扫描线填充，返回 dim×dim 的 L 掩膜。

    真值字体允许轮廓互相交叠（竹字头两笔常压在一起），所以不能用异或规则。
    """
    k = dim / TILE
    edges = []
    for polygon in polygons:
        count = len(polygon)
        for i in range(count):
            ax, ay = polygon[i]
            bx, by = polygon[(i + 1) % count]
            if ay == by:
                continue
            edges.append((ay * k, ax * k, by * k, bx * k))

    mask = Image.new("L", (dim, dim), 0)
    draw = ImageDraw.Draw(mask)
    for py in range(dim):
        y = py + 0.5
        crossings = []
        for ay, ax, by, bx in edges:
            if (ay <= y < by) or (by <= y < ay):
                t = (y - ay) / (by - ay)
                crossings.append((ax + t * (bx - ax), 1 if by > ay else -1))
        if not crossings:
            continue
        crossings.sort()
        winding = 0
        for i in range(len(crossings) - 1):
            winding += crossings[i][1]
            if winding:
                xa = crossings[i][0]
                xb = crossings[i + 1][0]
                if xb > xa:
                    draw.line([(xa, py + 0.5), (xb, py + 0.5)], fill=255, width=1)

    return mask


def glyph_mask(polygons, dim: int, stroke_units: float):
    """填充轮廓，再沿轮廓描一圈粗线——等价于 SVG 上同宽的 `stroke`。

    描边的并集就是「膨胀」：Minkowski 和。用描线而不是形态学滤波，是因为
    线宽能直接按设计单位算，不受超采样倍数取整的牵制。
    """
    mask = fill_mask(polygons, dim)
    if stroke_units <= 0:
        return mask

    k = dim / TILE
    width = max(1, round(stroke_units * k))
    draw = ImageDraw.Draw(mask)
    for contour in polygons:
        points = [(x * k, y * k) for x, y in contour]
        if points:
            # 闭合后再逐段描粗，joint="curve" 让拐角是圆的，与 SVG 的
            # stroke-linejoin="round" 一致
            draw.line(points + [points[0]], fill=255, width=width, joint="curve")
    return mask


def compose(size: int, polygons, ss: int = 4) -> Image.Image:
    """画一枚标记：渐变方印 + 发丝内圈 + 「简」。4 倍超采样后缩回。

    只有一件事随边长变化：内圈在 RING_MIN_SIZE 以下不画。字的粗细是设计单位，
    所以 16px 与 256px 是同一枚印，只是大小不同。
    """
    if size in _MARK_CACHE:
        return _MARK_CACHE[size]

    dim = size * ss
    k = dim / TILE
    draw_ring = size >= RING_MIN_SIZE

    accent = hex_rgb(ACCENT)
    top = mix(accent, (255, 255, 255), TOP_MIX)
    bottom = mix(accent, (0, 0, 0), BOTTOM_MIX)

    # 方印：竖向渐变，再套圆角
    gradient = Image.new("RGB", (1, dim))
    for y in range(dim):
        gradient.putpixel((0, y), mix(top, bottom, y / max(1, dim - 1)))
    tile = gradient.resize((dim, dim)).convert("RGBA")
    corner = Image.new("L", (dim, dim), 0)
    ImageDraw.Draw(corner).rounded_rectangle([0, 0, dim - 1, dim - 1], radius=RADIUS * k, fill=255)
    tile.putalpha(corner)

    # 内圈发丝。线宽取「几何宽度」与「一个设备像素」的较大值：亚像素的线
    # 渲染出来是一圈灰晕，那是模糊感的来源之一。
    if draw_ring:
        ring = Image.new("L", (dim, dim), 0)
        ImageDraw.Draw(ring).rounded_rectangle(
            [RING_INSET * k, RING_INSET * k, dim - 1 - RING_INSET * k, dim - 1 - RING_INSET * k],
            radius=RING_RADIUS * k,
            outline=255,
            width=max(1, round(max(TILE / size, RING_WIDTH) * k)),
        )
        ring_alpha = ring.point(lambda v: round(v * RING_ALPHA))
        ring_layer = Image.new("RGBA", (dim, dim), tint(hex_rgb(GLYPH), 0))
        ring_layer.putalpha(ring_alpha)
        tile = Image.alpha_composite(tile, ring_layer)

    # 「简」：填充 + 按设计单位描边，与组件里的 stroke 同宽
    glyph = glyph_mask(polygons, dim, GLYPH_STROKE)

    glyph_layer = Image.new("RGBA", (dim, dim), tint(hex_rgb(GLYPH), 1))
    glyph_layer.putalpha(glyph)
    tile = Image.alpha_composite(tile, glyph_layer)

    mark = tile.resize((size, size), Image.Resampling.LANCZOS)
    _MARK_CACHE[size] = mark
    return mark


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------


def wrap_path(d: str, width: int = 92) -> list[str]:
    parts = re.findall(r"[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*", d)
    lines: list[str] = []
    current = ""
    for part in parts:
        if current and len(current) + len(part) > width:
            lines.append(current)
            current = ""
        current += part
    if current:
        lines.append(current)
    return lines


def command_path(font_path: str) -> int:
    glyph_set, name, bounds = load_glyph(font_path, GLYPH_CHAR)
    scale, tx, ty = glyph_transform(bounds)
    d = glyph_path(glyph_set, name, scale, tx, ty)
    print(f"/* {os.path.basename(font_path)} · {GLYPH_CHAR} · 墨迹高 {GLYPH_INK:g}/{TILE:g} */")
    print("const GLYPH_PATH =")
    for line in wrap_path(d):
        print(f'  "{line}"')
    print("  ;")
    return 0


def write_svg(font_path: str) -> str:
    glyph_set, name, bounds = load_glyph(font_path, GLYPH_CHAR)
    scale, tx, ty = glyph_transform(bounds)
    d = glyph_path(glyph_set, name, scale, tx, ty)

    accent = hex_rgb(ACCENT)
    top = "#%02x%02x%02x" % mix(accent, (255, 255, 255), TOP_MIX)
    bottom = "#%02x%02x%02x" % mix(accent, (0, 0, 0), BOTTOM_MIX)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TILE:g} {TILE:g}" role="img" aria-label="青简">
  <defs>
    <linearGradient id="qj-tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bottom}"/>
    </linearGradient>
  </defs>
  <rect width="{TILE:g}" height="{TILE:g}" rx="{RADIUS:g}" fill="url(#qj-tile)"/>
  <rect x="{RING_INSET:g}" y="{RING_INSET:g}" width="{TILE - RING_INSET * 2:g}" height="{TILE - RING_INSET * 2:g}"
        rx="{RING_RADIUS:g}" fill="none" stroke="{GLYPH}" stroke-opacity="{RING_ALPHA:g}" stroke-width="{RING_WIDTH:g}"/>
  <path d="{d}" fill="{GLYPH}" stroke="{GLYPH}" stroke-width="{GLYPH_STROKE:g}"
        stroke-linejoin="round"/>
</svg>
"""
    path = os.path.join(ROOT, "public", "qingjian.svg")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(svg)
    return path


def reorder_ico(path: str) -> list[int]:
    """把 ICO 的目录项按边长从大到小重排，返回新的条目顺序。

    只需重排**目录**：每个条目自带图像数据的偏移，数据本身不用搬。
    Pillow 写出时总按升序排，所以这个后处理是必要的——Tauri 取第一个条目
    当窗口图标，它必须是最大的那张。
    """
    raw = bytearray(open(path, "rb").read())
    count = int.from_bytes(raw[4:6], "little")

    records = []
    for index in range(count):
        offset = 6 + index * 16
        entry = bytes(raw[offset : offset + 16])
        records.append((entry[0] or 256, entry))  # 宽 0 表示 256

    records.sort(key=lambda item: -item[0])
    for index, (_, entry) in enumerate(records):
        offset = 6 + index * 16
        raw[offset : offset + 16] = entry

    with open(path, "wb") as handle:
        handle.write(raw)
    return [width for width, _ in records]


def write_icons(font_path: str) -> list[str]:
    glyph_set, name, bounds = load_glyph(font_path, GLYPH_CHAR)
    scale, tx, ty = glyph_transform(bounds)
    polygons = glyph_polygons(glyph_set, name, scale, tx, ty)

    os.makedirs(ICON_DIR, exist_ok=True)
    written: list[str] = []

    for filename, size in sorted(PNG_SIZES.items(), key=lambda item: item[1]):
        target = os.path.join(ICON_DIR, filename)
        compose(size, polygons).save(target, format="PNG")
        written.append(target)

    largest = compose(512, polygons)
    ico = os.path.join(ICON_DIR, "icon.ico")
    largest.save(ico, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    order = reorder_ico(ico)
    print(f"ico 条目顺序（第一个会被 Tauri 当作窗口图标）：{order}")
    written.append(ico)

    # Pillow 的 ICNS 写出只会存一个尺寸，而且会把源图**放大**到 1024——
    # 拿 512 当源会得到一张插值过的图。所以这里单独按 1024 画一次。
    icns = os.path.join(ICON_DIR, "icon.icns")
    compose(1024, polygons).save(icns, format="ICNS")
    written.append(icns)

    return written


# --------------------------------------------------------------------------
# 自检
# --------------------------------------------------------------------------


def check(font_path: str) -> int:
    from PIL import ImageFont

    failures: list[str] = []

    glyph_set, name, bounds = load_glyph(font_path, GLYPH_CHAR)
    scale, tx, ty = glyph_transform(bounds)
    polygons = glyph_polygons(glyph_set, name, scale, tx, ty)

    # 1. path 是否落在预期位置
    xs = [p[0] for contour in polygons for p in contour]
    ys = [p[1] for contour in polygons for p in contour]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    centre = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    print(f"轮廓墨迹 {width:.2f} × {height:.2f}，中心 ({centre[0]:.2f}, {centre[1]:.2f})")
    if abs(height - GLYPH_INK) > 0.05:
        failures.append(f"墨迹高 {height:.2f}，应为 {GLYPH_INK}")
    if abs(centre[0] - TILE / 2) > 0.05 or abs(centre[1] - TILE / 2) > 0.05:
        failures.append("墨迹没有居中")

    # 2. 抽出的轮廓与字体自身渲染是否一致（列投影相关性）
    dim = 256
    mine = fill_mask(polygons, dim)
    target = GLYPH_INK / TILE * dim

    probe = ImageFont.truetype(font_path, 400)
    box = probe.getbbox(GLYPH_CHAR)
    size = round(400 * target / (box[3] - box[1]))
    font = ImageFont.truetype(font_path, size)
    box = font.getbbox(GLYPH_CHAR)
    theirs = Image.new("L", (dim, dim), 0)
    ImageDraw.Draw(theirs).text(
        ((dim - (box[2] - box[0])) / 2 - box[0], (dim - (box[3] - box[1])) / 2 - box[1]),
        GLYPH_CHAR,
        font=font,
        fill=255,
    )

    def columns(image):
        small = image.resize((dim, 1), Image.Resampling.BOX)
        data = small.tobytes()
        total = sum(data) or 1
        return [v / total for v in data]

    mine_cols, theirs_cols = columns(mine), columns(theirs)
    drift = max(abs(a - b) for a, b in zip(mine_cols, theirs_cols))
    print(f"轮廓 vs 字体渲染：列投影最大偏差 {drift:.4f}（阈值 0.02）")
    if drift > 0.02:
        failures.append(f"轮廓与字体渲染偏差过大（{drift:.4f}）")

    # 3. 图标文件确实写对了
    from PIL import Image as _Image

    for filename, size in sorted(PNG_SIZES.items(), key=lambda item: item[1]):
        target_path = os.path.join(ICON_DIR, filename)
        if not os.path.exists(target_path):
            failures.append(f"缺少 {filename}")
            continue
        image = _Image.open(target_path).convert("RGBA")
        if image.size != (size, size):
            failures.append(f"{filename} 尺寸 {image.size}，应为 {(size, size)}")
            continue
        if image.getpixel((0, 0))[3] != 0:
            failures.append(f"{filename} 左上角不透明，圆角没做出来")
        if image.getpixel((size // 2, size // 2))[3] != 255:
            failures.append(f"{filename} 中心透明，方印没铺满")

    for filename in ("icon.ico", "icon.icns"):
        target_path = os.path.join(ICON_DIR, filename)
        if os.path.exists(target_path) and os.path.getsize(target_path) > 1000:
            print(f"{filename}: {os.path.getsize(target_path)} 字节")
        else:
            failures.append(f"{filename} 缺失或过小")

    # 4. ICO 必须带齐 Windows 真正会请求的机型尺寸（少 20/40/96 的话，125% 与
    #    150% 缩放下系统只能拿相邻帧去缩放），而且**第一个条目要是最大的**。
    ico_path = os.path.join(ICON_DIR, "icon.ico")
    if os.path.exists(ico_path):
        raw = open(ico_path, "rb").read()
        count = int.from_bytes(raw[4:6], "little")
        entries = []
        for index in range(count):
            width = raw[6 + index * 16] or 256
            entries.append(width)
        print(f"ico 帧（按写入顺序）：{entries}")
        missing = [s for s in ICO_SIZES if s not in entries]
        if missing:
            failures.append(f"ico 缺尺寸 {missing}")
        # Tauri 拿第一个条目当窗口图标，它必须足够大，否则任务栏就是把小图放大
        if entries and entries[0] != max(entries):
            failures.append(
                f"ico 第一个条目是 {entries[0]}px，应为最大的 {max(entries)}px"
                "（Tauri 取它当运行时窗口图标）"
            )

    # 5. ICNS 不能是放大出来的：Pillow 的 ICNS 写出固定 1024，源图小了会被插值。
    icns_path = os.path.join(ICON_DIR, "icon.icns")
    if os.path.exists(icns_path):
        icns_size = _Image.open(icns_path).size
        print(f"icns 内尺寸：{icns_size}")
        if icns_size != (1024, 1024):
            failures.append(f"icns 内尺寸 {icns_size}，应为 (1024, 1024)")

    # 6. 字得真的有分量。未加粗时 16px 实心占比 0.023、32px 0.071，看着就是
    #    一团灰；描 3 单位的边之后是 0.109 / 0.127。这里钉住下限。
    print()
    for size in (16, 32, 48):
        glyph = glyph_mask(polygons, size * 4, GLYPH_STROKE)
        glyph = glyph.resize((size, size), Image.Resampling.LANCZOS)
        ink = glyph.tobytes()
        solid = sum(1 for v in ink if v >= 200) / len(ink)
        mid = sum(1 for v in ink if 60 <= v < 200) / len(ink)
        print(f"{size:3d}px 字：描边 {GLYPH_STROKE:g} 单位 → 实心 {solid:.3f} 灰边 {mid:.3f}")
        if solid < 0.09:
            failures.append(f"{size}px 的字偏灰（实心占比 {solid:.3f}，应 >= 0.09）")

    if failures:
        print("\n自检未通过：")
        for item in failures:
            print(" -", item)
        return 1

    print("\n自检通过。")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="生成青简的品牌标记")
    parser.add_argument("--font", help="字形来源字体，默认 SimSun")
    parser.add_argument("--path", action="store_true", help="只打印 SVG path")
    parser.add_argument("--svg", action="store_true", help="只写 public/qingjian.svg")
    parser.add_argument("--icons", action="store_true", help="只写图标")
    parser.add_argument("--check", action="store_true", help="只自检")
    args = parser.parse_args()

    font_path = pick_font(args.font)
    print(f"字形来源：{font_path}\n")

    selected = args.path or args.svg or args.icons or args.check
    status = 0

    if args.path or not selected:
        status |= command_path(font_path)
        print()
    if args.svg or not selected:
        print("写入", os.path.relpath(write_svg(font_path), ROOT), "\n")
    if args.icons or not selected:
        for target in write_icons(font_path):
            print("写入", os.path.relpath(target, ROOT))
        print()
    if args.check or not selected:
        status |= check(font_path)

    return status


if __name__ == "__main__":
    raise SystemExit(main())
