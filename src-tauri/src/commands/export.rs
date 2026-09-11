use std::borrow::Cow;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::docx;

/* -------------------------------------------------------------------------- */
/* Document model                                                             */
/*                                                                            */
/* The frontend parses Markdown once and sends this shape, so every renderer  */
/* walks the same tree. Keeping it here rather than parsing Markdown in Rust  */
/* also means the export sees exactly what the editor sees — the alignment    */
/* attributes and image sizes included.                                       */
/* -------------------------------------------------------------------------- */

/// A run of text with one kind of emphasis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Inline {
    Text { v: String },
    Bold { v: String },
    Italic { v: String },
    Strike { v: String },
    Code { v: String },
    Link { v: String, href: String },
    /// `file` is an absolute path when the frontend could resolve one, which is
    /// what lets the renderers embed the picture instead of linking to it.
    Image {
        v: String,
        src: String,
        #[serde(default)]
        file: Option<String>,
        /// The scale the editor stored, read from the Markdown `alt`; `None`
        /// leaves the picture at its natural size.
        #[serde(default)]
        ratio: Option<f32>,
    },
    /// A line break inside a paragraph, written by the editor as `<br />`.
    Br,
    /// Raw inline HTML, passed through to the exported page as markup.
    ///
    /// The frontend only sends tags from a small list of prose-level ones, and
    /// only without attributes, so this is not a way for a document to inject a
    /// script into the export.
    Html { v: String },
    ///
    /// A formula: the LaTeX source and the MathML the frontend rendered it to.
    /// `mathml` is empty when the source could not be parsed, and the renderers
    /// then show `tex` as code rather than losing it.
    Math { tex: String, mathml: String },
}

impl Inline {
    /// The plain text of a run, used by the text renderer.
    ///
    /// A formula has no plain rendering worth reading, so its source is what the
    /// text export carries — the reader can still paste it somewhere that
    /// understands LaTeX.
    fn text(&self) -> Cow<'_, str> {
        match self {
            Inline::Text { v }
            | Inline::Bold { v }
            | Inline::Italic { v }
            | Inline::Strike { v }
            | Inline::Code { v }
            | Inline::Link { v, .. }
            | Inline::Image { v, .. } => Cow::Borrowed(v),
            Inline::Br => Cow::Borrowed("\n"),
            Inline::Math { tex, .. } => Cow::Owned(format!("${tex}$")),
            // Markup carries no text of its own.
            Inline::Html { .. } => Cow::Borrowed(""),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListItem {
    pub blocks: Vec<Block>,
    /// Present for a task item (`- [ ]` / `- [x]`); `None` for an ordinary one.
    #[serde(default)]
    pub checked: Option<bool>,
}

/// One block of the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Block {
    Heading {
        level: u8,
        align: String,
        runs: Vec<Inline>,
    },
    Paragraph {
        align: String,
        runs: Vec<Inline>,
    },
    Code {
        lang: String,
        text: String,
    },
    Quote {
        blocks: Vec<Block>,
    },
    List {
        ordered: bool,
        items: Vec<ListItem>,
    },
    Table {
        aligns: Vec<Option<String>>,
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Hr,
    Image {
        align: String,
        src: String,
        #[serde(default)]
        file: Option<String>,
        /// The scale the editor stored, read from the Markdown `alt`.
        #[serde(default)]
        ratio: Option<f32>,
        caption: String,
    },
    /// A display formula, written in the note as `$$ … $$`.
    ///
    /// Spelled out because the enum's lowercase rule would turn the variant name
    /// into `mathblock`, which is not what the frontend sends.
    #[serde(rename = "mathBlock")]
    MathBlock { tex: String, mathml: String },
}

/* -------------------------------------------------------------------------- */
/* Export styles                                                              */
/* -------------------------------------------------------------------------- */

/// How the document should look on paper — the mapping the settings dialog
/// exposes, level by level. Values are points and millimetres because those are
/// the units Word and print work in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStyles {
    pub body_font: String,
    pub body_font_size: f32,
    pub body_line_height: f32,

    /// Empty means "follow the body font".
    pub heading_font: String,
    pub heading_bold: bool,
    /// Empty means the renderer's own default; otherwise `#rrggbb`.
    pub heading_color: String,
    /// One entry per level, 1 through 6.
    pub heading_sizes: Vec<f32>,
    pub heading_space_before: f32,
    pub heading_space_after: f32,

    pub code_font: String,
    pub code_font_size: f32,
    pub code_background: String,

    /// `a4` or `letter`.
    pub page_size: String,
    pub margin_top: f32,
    pub margin_bottom: f32,
    pub margin_left: f32,
    pub margin_right: f32,

    pub table_borders: bool,
    pub table_header_fill: String,

    pub image_max_width: f32,

    /// Written as a title above the document; empty for none.
    pub title: String,
}

impl ExportStyles {
    /// Point size for a heading level, clamped and falling back to the body
    /// size so a malformed settings row cannot produce a zero-size heading.
    pub fn heading_size(&self, level: u8) -> f32 {
        let index = level.saturating_sub(1) as usize;
        self.heading_sizes
            .get(index)
            .copied()
            .filter(|size| *size > 0.0)
            .unwrap_or(self.body_font_size + 4.0)
    }

    /// Headings space out less as they get smaller, which is what makes a
    /// document read as a hierarchy rather than a list.
    ///
    /// Rounded to a tenth of a point: the scaled values are written straight
    /// into CSS, and `11.900001pt` is not something a person should have to read.
    pub fn heading_spacing(&self, level: u8) -> (f32, f32) {
        let scale = match level {
            1 => 1.0,
            2 => 0.85,
            3 => 0.7,
            4 => 0.55,
            5 => 0.45,
            _ => 0.4,
        };
        let round = |value: f32| (value * 10.0).round() / 10.0;
        (
            round(self.heading_space_before * scale),
            round(self.heading_space_after * scale),
        )
    }

    pub fn heading_family(&self) -> &str {
        if self.heading_font.trim().is_empty() {
            &self.body_font
        } else {
            &self.heading_font
        }
    }

    /// Page size in millimetres, as Word and CSS both want.
    pub fn page_mm(&self) -> (f32, f32) {
        match self.page_size.as_str() {
            "letter" => (215.9, 279.4),
            _ => (210.0, 297.0),
        }
    }

    /// The user's maximum image width as a percentage, bounded to something a
    /// page can actually hold.
    pub fn cap_percent(&self) -> f32 {
        if self.image_max_width > 0.0 {
            self.image_max_width.clamp(1.0, 100.0)
        } else {
            100.0
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

fn is_hex_color(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() == 7 && trimmed.starts_with('#') && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// A colour the caller supplied, or a fallback when they left it blank.
pub fn color_or(value: &str, fallback: &str) -> String {
    if is_hex_color(value) {
        value.trim().to_string()
    } else {
        fallback.to_string()
    }
}

/// Escapes text for XML and HTML, which share the same five characters.
pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Reads an image from disk, capped so a huge file cannot exhaust memory.
///
/// Shared with the Word renderer, which embeds the same bytes as a media part.
pub fn read_image(file: &str) -> Option<(Vec<u8>, String)> {
    const MAX: u64 = 32 * 1024 * 1024;
    let path = Path::new(file);
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".into());
    Some((data, extension))
}

/// Pixel dimensions of a PNG or JPEG, read from its header.
///
/// Word wants an explicit extent for a drawing and there is no image crate here,
/// so the two formats a document realistically contains are read directly.
pub fn image_size(data: &[u8]) -> Option<(u32, u32)> {
    if data.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        // IHDR is always the first chunk: 8 signature + 4 length + 4 type + 4 width + 4 height.
        let width = u32::from_be_bytes(data.get(16..20)?.try_into().ok()?);
        let height = u32::from_be_bytes(data.get(20..24)?.try_into().ok()?);
        return (width > 0 && height > 0).then_some((width, height));
    }

    if data.starts_with(&[0xff, 0xd8]) {
        let mut index = 2;
        while index + 9 < data.len() {
            if data[index] != 0xff {
                index += 1;
                continue;
            }
            let marker = data[index + 1];
            // SOF0…SOF15 minus the two that are not frame headers.
            let is_frame = (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
            let length = u16::from_be_bytes([data[index + 2], data[index + 3]]) as usize;
            if is_frame {
                let height = u16::from_be_bytes([data[index + 5], data[index + 6]]) as u32;
                let width = u16::from_be_bytes([data[index + 7], data[index + 8]]) as u32;
                return (width > 0 && height > 0).then_some((width, height));
            }
            if length < 2 {
                return None;
            }
            index += 2 + length;
        }
    }

    None
}

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

fn font_stack(family: &str, fallback: &str) -> String {
    let trimmed = family.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        format!("\"{}\", {}", trimmed.replace('"', ""), fallback)
    }
}

/// The inline style that reproduces the picture's size on screen.
///
/// `ratio` is the scale the editor stored (`1` is natural size) and `cap` is the
/// user's global maximum-width percentage. Whichever is smaller wins, so a
/// picture that was shrunk stays shrunk and one that was not still cannot run
/// past the text column. Empty when there is nothing to override.
fn image_style(ratio: Option<f32>, cap: f32) -> String {
    let Some(ratio) = ratio else {
        return String::new();
    };
    let width = (ratio.clamp(0.01, 1.0) * 100.0).min(cap.clamp(1.0, 100.0));
    format!(" style=\"max-width: {width:.1}%\"")
}

fn inline_html(runs: &[Inline], styles: &ExportStyles) -> String {
    let mut out = String::new();
    for run in runs {
        match run {
            Inline::Text { v } => out.push_str(&escape(v)),
            Inline::Bold { v } => out.push_str(&format!("<strong>{}</strong>", escape(v))),
            Inline::Italic { v } => out.push_str(&format!("<em>{}</em>", escape(v))),
            Inline::Strike { v } => out.push_str(&format!("<del>{}</del>", escape(v))),
            Inline::Code { v } => out.push_str(&format!("<code>{}</code>", escape(v))),
            Inline::Link { v, href } => out.push_str(&format!(
                "<a href=\"{}\">{}</a>",
                escape(href),
                escape(v)
            )),
            Inline::Image {
                v,
                src,
                file,
                ratio,
            } => match file.as_deref().and_then(embed_data_url) {
                // Embedded, so the exported file stands on its own.
                Some(url) => out.push_str(&format!(
                    "<img src=\"{url}\" alt=\"{}\"{} />",
                    escape(v),
                    image_style(*ratio, styles.cap_percent())
                )),
                None => out.push_str(&format!(
                    "<img src=\"{}\" alt=\"{}\"{} />",
                    escape(src),
                    escape(v),
                    image_style(*ratio, styles.cap_percent())
                )),
            },
            Inline::Br => out.push_str("<br />"),
            // Already markup, and from a list the frontend controls.
            Inline::Html { v } => out.push_str(v),
            // MathML is drawn by the reader's engine, so the exported page needs
            // no stylesheet, font or script of its own. It is generated by KaTeX
            // from the user's own source, so it goes in as-is; the escaped source
            // is the fallback when there is nothing to draw.
            Inline::Math { tex, mathml } => {
                if mathml.trim().is_empty() {
                    out.push_str(&format!("<code>{}</code>", escape(tex)));
                } else {
                    out.push_str(&format!("<span class=\"qj-math\">{mathml}</span>"));
                }
            }
        }
    }
    out
}

fn embed_data_url(file: &str) -> Option<String> {
    let (data, extension) = read_image(file)?;
    let mime = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(data)))
}

fn blocks_html(blocks: &[Block], styles: &ExportStyles) -> String {
    let mut out = String::new();
    for block in blocks {
        out.push_str(&block_html(block, styles));
    }
    out
}

/// One list item's contents.
///
/// The item's opening paragraph goes straight into the `<li>`, without a `<p>`
/// wrapper: a block child would push the marker onto a line of its own and add a
/// paragraph gap under it, which is what makes an exported list read as loose
/// prose. A later paragraph keeps its wrapper, so a wrapped item still separates.
/// The item's own alignment is dropped for the same reason — the marker and the
/// first line have to share one line box.
fn list_item_html(item: &ListItem, styles: &ExportStyles) -> String {
    let mut out = String::new();
    let mut first = true;

    for block in &item.blocks {
        match block {
            Block::Paragraph { runs, .. } if first => out.push_str(&inline_html(runs, styles)),
            _ => out.push_str(&block_html(block, styles)),
        }
        first = false;
    }

    out
}

fn block_html(block: &Block, styles: &ExportStyles) -> String {
    let align_class = |align: &str| match align {
        "center" => " class=\"align-center\"",
        "right" => " class=\"align-right\"",
        _ => "",
    };

    match block {
        Block::Heading { level, align, runs } => {
            let level = (*level).clamp(1, 6);
            format!(
                "<h{level}{}>{}</h{level}>\n",
                align_class(align),
                inline_html(runs, styles)
            )
        }
        Block::Paragraph { align, runs } => {
            format!("<p{}>{}</p>\n", align_class(align), inline_html(runs, styles))
        }
        Block::Code { lang, text } => format!(
            "<pre{}{}><code>{}</code></pre>\n",
            if lang.is_empty() {
                String::new()
            } else {
                format!(" data-lang=\"{}\"", escape(lang))
            },
            "",
            escape(text)
        ),
        Block::Quote { blocks } => {
            format!("<blockquote>\n{}</blockquote>\n", blocks_html(blocks, styles))
        }
        Block::List { ordered, items } => {
            let tag = if *ordered { "ol" } else { "ul" };
            let mut out = format!("<{tag}>\n");
            for item in items {
                // The class rides on the item, not the list, so a mixed list keeps
                // its bullets for the ordinary entries.
                let (class, marker) = match item.checked {
                    Some(true) => (" class=\"task-item\"", "<span class=\"task-box\">☑</span>"),
                    Some(false) => (" class=\"task-item\"", "<span class=\"task-box\">☐</span>"),
                    None => ("", ""),
                };
                out.push_str(&format!(
                    "<li{class}>{marker}{}</li>\n",
                    list_item_html(item, styles)
                ));
            }
            out.push_str(&format!("</{tag}>\n"));
            out
        }
        Block::Table { aligns, head, rows } => {
            let mut out = String::from("<table>\n<thead>\n<tr>");
            for (index, cell) in head.iter().enumerate() {
                out.push_str(&format!(
                    "<th{}>{}</th>",
                    align_class(aligns.get(index).and_then(|a| a.as_deref()).unwrap_or("left")),
                    inline_html(cell, styles)
                ));
            }
            out.push_str("</tr>\n</thead>\n<tbody>\n");
            for row in rows {
                out.push_str("<tr>");
                for (index, cell) in row.iter().enumerate() {
                    out.push_str(&format!(
                        "<td{}>{}</td>",
                        align_class(aligns.get(index).and_then(|a| a.as_deref()).unwrap_or("left")),
                        inline_html(cell, styles)
                    ));
                }
                out.push_str("</tr>\n");
            }
            out.push_str("</tbody>\n</table>\n");
            out
        }
        Block::Hr => "<hr />\n".to_string(),
        Block::Image {
            align,
            src,
            file,
            ratio,
            caption,
        } => {
            let url = file
                .as_deref()
                .and_then(embed_data_url)
                .unwrap_or_else(|| src.clone());
            let caption = if caption.trim().is_empty() {
                String::new()
            } else {
                format!("<figcaption>{}</figcaption>", escape(caption))
            };
            format!(
                "<figure{}><img src=\"{}\" alt=\"{}\"{} />{caption}</figure>\n",
                align_class(align),
                escape(&url),
                escape(caption.as_str()),
                image_style(*ratio, styles.cap_percent())
            )
        }
        Block::MathBlock { tex, mathml } => {
            if mathml.trim().is_empty() {
                format!("<pre class=\"qj-math-source\"><code>{}</code></pre>\n", escape(tex))
            } else {
                format!("<div class=\"qj-math-block\">{mathml}</div>\n")
            }
        }
    }
}

/// A standalone HTML file: the stylesheet carries the whole style mapping, and
/// images are embedded, so the result can be mailed as one file.
pub fn render_html(blocks: &[Block], styles: &ExportStyles) -> String {
    let (page_w, page_h) = styles.page_mm();
    let heading_font = font_stack(
        styles.heading_family(),
        "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif",
    );
    // A bare `serif` has no CJK coverage on Windows, which would send every
    // Chinese character to a fallback face chosen by the browser.
    let body_font = font_stack(
        &styles.body_font,
        "\"Songti SC\", SimSun, Georgia, serif",
    );
    let code_font = font_stack(
        &styles.code_font,
        "ui-monospace, \"Cascadia Code\", Consolas, monospace",
    );
    let heading_color = if is_hex_color(&styles.heading_color) {
        styles.heading_color.trim().to_string()
    } else {
        "#1a1a1a".to_string()
    };
    let code_bg = color_or(&styles.code_background, "#f5f5f5");
    let header_fill = color_or(&styles.table_header_fill, "#f2f2f2");

    let mut heading_rules = String::new();
    for level in 1..=6u8 {
        let (before, after) = styles.heading_spacing(level);
        heading_rules.push_str(&format!(
            "  h{level} {{ font-size: {size}pt; margin: {before}pt 0 {after}pt; font-weight: {weight}; }}\n",
            size = styles.heading_size(level),
            weight = if styles.heading_bold { 700 } else { 400 },
        ));
    }

    let title = if styles.title.trim().is_empty() {
        String::new()
    } else {
        format!("<h1 class=\"doc-title\">{}</h1>\n", escape(&styles.title))
    };

    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>{title_text}</title>
<style>
  /* The margins are carried by the body, not by `@page`: WebView2's silent PDF
     path ignores a CSS page margin and uses its own print settings, so keeping
     the inset in the flow makes the file, the browser's print dialog and the
     in-app export agree on one layout. */
  @page {{ size: {page_w}mm {page_h}mm; margin: 0; }}
  html {{ background: #fff; }}
  body {{
    margin: 0 auto;
    padding: {mt}mm {mr}mm {mb}mm {ml}mm;
    max-width: {content_w}mm;
    font-family: {body_font};
    font-size: {body_size}pt;
    line-height: {line_height};
    color: #1f1f1f;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  h1, h2, h3, h4, h5, h6 {{ font-family: {heading_font}; color: {heading_color}; line-height: 1.3; }}
{heading_rules}  .align-center {{ text-align: center; }}
  .align-right {{ text-align: right; }}
  p {{ margin: 0 0 0.75em; }}
  code {{ font-family: {code_font}; font-size: {code_size}pt; background: {code_bg}; border-radius: 3px; padding: 0.1em 0.3em; }}
  pre {{ background: {code_bg}; border-radius: 4px; padding: 10px 12px; overflow-x: auto; }}
  pre code {{ background: none; padding: 0; font-size: {code_size}pt; line-height: 1.5; white-space: pre-wrap; }}
  blockquote {{ margin: 0 0 0.9em; padding: 0.2em 0 0.2em 1em; border-left: 3px solid #d8d8d8; color: #555; }}
  figure {{ margin: 0.6em 0 1em; }}
  figure.align-center {{ text-align: center; }}
  figure.align-right {{ text-align: right; }}
  /* Applies to pictures inside a paragraph as well as figures; a per-image
     scale, when there is one, arrives as an inline style and wins over this. */
  img {{ max-width: {image_max}; height: auto; }}
  figcaption {{ margin-top: 0.35em; font-size: {body_size}pt; color: #777; text-align: center; }}
  table {{ border-collapse: collapse; width: 100%; margin: 0 0 1em; }}
  th, td {{ padding: 5px 9px; {table_border} }}
  th {{ background: {header_fill}; font-weight: 600; }}
  li.task-item {{ list-style: none; }}
  .task-box {{ display: inline-block; min-width: 1.1em; }}
  /* Formulas: MathML is laid out by the engine, so only the block's placement
     and a touch of size are ours. */
  .qj-math-block {{ margin: 0.9em 0; text-align: center; }}
  .qj-math-block > math {{ font-size: 1.15em; }}
  .qj-math > math {{ font-size: 1.05em; }}
  .qj-math-source {{ text-align: left; }}
  math {{ font-family: "Cambria Math", "Latin Modern Math", serif; }}
  hr {{ border: none; border-top: 1px solid #d8d8d8; margin: 1.4em 0; }}
  a {{ color: #1a56a8; }}
  /* Lists ----------------------------------------------------------------
     An item's own paragraphs sit inside the item, so only the gap between two
     of them is kept. */
  li > p {{ margin: 0 0 0.3em; }}
  li > p:last-child {{ margin-bottom: 0; }}
  li {{ margin-bottom: 0.15em; }}
  /* Numbered after their parents — 1., then 1.1, 1.1.1 — so the nesting stays
     legible on paper, where indentation alone is easy to miss. */
  ol {{ counter-reset: qj-item; }}
  ol > li {{ counter-increment: qj-item; }}
  ol > li::marker {{ content: counters(qj-item, ".") ". "; }}
  ul {{ list-style-type: disc; }}
  ul ul {{ list-style-type: circle; }}
  ul ul ul {{ list-style-type: square; }}
  /* Pagination: a heading never ends a page alone, and a table header repeats. */
  h1, h2, h3, h4, h5, h6 {{ break-after: avoid-page; page-break-after: avoid; }}
  figure, blockquote, pre {{ break-inside: avoid; page-break-inside: avoid; }}
  tr {{ break-inside: avoid; page-break-inside: avoid; }}
  p {{ orphans: 2; widows: 2; }}
  thead {{ display: table-header-group; }}
</style>
</head>
<body>
{title}{body}
</body>
</html>
"#,
        title_text = escape(if styles.title.trim().is_empty() {
            "青简导出"
        } else {
            styles.title.as_str()
        }),
        mt = styles.margin_top,
        mb = styles.margin_bottom,
        ml = styles.margin_left,
        mr = styles.margin_right,
        content_w = page_w - styles.margin_left - styles.margin_right,
        body_size = styles.body_font_size,
        line_height = styles.body_line_height,
        code_size = styles.code_font_size,
        image_max = format!("{}%", styles.cap_percent()),
        table_border = if styles.table_borders {
            "border: 1px solid #d8d8d8;"
        } else {
            ""
        },
        body = blocks_html(blocks, styles),
    )
}

/* -------------------------------------------------------------------------- */
/* Plain text                                                                 */
/* -------------------------------------------------------------------------- */

fn runs_text(runs: &[Inline]) -> String {
    runs.iter().map(Inline::text).collect()
}

fn blocks_text(blocks: &[Block], indent: usize) -> String {
    let pad = " ".repeat(indent);
    let mut out = String::new();

    for block in blocks {
        match block {
            Block::Heading { level, runs, .. } => {
                out.push_str(&format!(
                    "{pad}{} {}\n\n",
                    "#".repeat((*level).clamp(1, 6) as usize),
                    runs_text(runs)
                ));
            }
            Block::Paragraph { runs, .. } => {
                out.push_str(&format!("{pad}{}\n\n", runs_text(runs)));
            }
            Block::Code { text, .. } => {
                for line in text.lines() {
                    out.push_str(&format!("{pad}    {line}\n"));
                }
                out.push('\n');
            }
            Block::Quote { blocks } => out.push_str(&blocks_text(blocks, indent + 2)),
            Block::List { ordered, items } => {
                for (index, item) in items.iter().enumerate() {
                    // A task item's checkbox replaces the bullet, so the two
                    // markers do not end up side by side.
                    let marker = match item.checked {
                        Some(true) => "☑ ".to_string(),
                        Some(false) => "☐ ".to_string(),
                        None if *ordered => format!("{}. ", index + 1),
                        None => "• ".to_string(),
                    };

                    // The item body is rendered already indented for the marker,
                    // so the first line hands its indentation over to the marker
                    // itself; later lines keep it, which is what lines a wrapped
                    // item up under its text rather than under the bullet.
                    let rendered = blocks_text(&item.blocks, indent + marker.len());
                    let mut lines = rendered.trim_end().lines();
                    match lines.next() {
                        Some(first) => {
                            out.push_str(&format!("{pad}{marker}{}\n", first.trim_start()));
                            for line in lines {
                                out.push_str(line);
                                out.push('\n');
                            }
                        }
                        None => out.push_str(&format!("{pad}{marker}\n")),
                    }
                }
                out.push('\n');
            }
            Block::Table { head, rows, .. } => {
                // A row is a list of cells; each cell is a list of runs.
                let row_text = |cells: &[Vec<Inline>]| {
                    cells
                        .iter()
                        .map(|cell| cell.iter().map(|run| run.text()).collect::<String>())
                        .collect::<Vec<_>>()
                        .join(" | ")
                };

                out.push_str(&format!("{pad}{}\n", row_text(head)));
                for row in rows {
                    out.push_str(&format!("{pad}{}\n", row_text(row)));
                }
                out.push('\n');
            }
            Block::Hr => out.push_str(&format!("{pad}---\n\n")),
            Block::Image { caption, src, .. } => {
                let label = if caption.trim().is_empty() {
                    src.as_str()
                } else {
                    caption.as_str()
                };
                out.push_str(&format!("{pad}[图片：{label}]\n\n"));
            }
            Block::MathBlock { tex, .. } => {
                // The source is the only faithful plain-text rendering.
                out.push_str(&format!("{pad}$${tex}$$\n\n"));
            }
        }
    }

    out
}

pub fn render_text(blocks: &[Block], styles: &ExportStyles) -> String {
    let title = if styles.title.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n\n", styles.title)
    };
    format!("{title}{}", blocks_text(blocks, 0))
}

/* -------------------------------------------------------------------------- */
/* Command                                                                    */
/* -------------------------------------------------------------------------- */

/// Renders the document as a standalone HTML page without writing it anywhere.
///
/// This is what the in-app print path needs: the webview prints a document, not
/// the editor chrome, and the print dialog can save the result as a PDF, so the
/// file never has to pass through this side.
#[tauri::command]
pub fn render_export(blocks: Vec<Block>, styles: ExportStyles) -> AppResult<String> {
    Ok(render_html(&blocks, &styles))
}

/// Writes the document to a path the user picked, in the requested format.
///
/// The caller picks the path (through the system save dialog), so this only
/// decides the bytes and refuses an extension it does not render — a "docx"
/// holding HTML would open in Word as an error rather than a document.
#[tauri::command]
pub async fn export_document(
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
    format: String,
    blocks: Vec<Block>,
    styles: ExportStyles,
    path: String,
) -> AppResult<String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err(AppError::Message("导出路径为空".into()));
    }

    let bytes: Vec<u8> = match format.as_str() {
        // PDF is not a byte string this side produces: the webview's print
        // pipeline lays the page out and writes the file itself.
        "pdf" => return super::pdf::write(&app, &target, &blocks, &styles).await,
        "docx" => docx::build_docx(&blocks, &styles)?,
        "html" => render_html(&blocks, &styles).into_bytes(),
        "txt" => render_text(&blocks, &styles).into_bytes(),
        other => {
            return Err(AppError::Message(format!("不支持的导出格式：{other}")));
        }
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, bytes)?;

    Ok(target.to_string_lossy().to_string())
}
