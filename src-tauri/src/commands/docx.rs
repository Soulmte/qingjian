//! OOXML (.docx) writer.
//!
//! A `.docx` is a ZIP package of XML parts. Word silently repairs a file when a
//! part is missing or a relationship dangles, so every part is emitted even when
//! the document does not use it (numbering, for instance).

use std::collections::BTreeSet;
use std::io::{Cursor, Seek, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{AppError, AppResult};

use super::omml;
use super::export::{
    color_or, escape, image_size, read_image, Block, ExportStyles, Inline, ListItem,
};

const XML_DECL: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;

const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_M: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_PKG_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_TYPES: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// `abstractNumId` values defined in `word/numbering.xml`.
const ABSTRACT_BULLET: u32 = 0;
const ABSTRACT_DECIMAL: u32 = 1;

/// Relationship ids reserved in `word/_rels/document.xml.rels`; media and
/// hyperlink ids are allocated after these.
const REL_STYLES: u32 = 1;
const REL_NUMBERING: u32 = 2;
const FIRST_FREE_REL: u32 = 3;

const HR_XML: &str = r#"<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D8D8D8"/></w:pBdr></w:pPr></w:p>"#;

const TABLE_BORDERS: &str = r#"<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/><w:left w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/><w:right w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D8D8D8"/></w:tblBorders>"#;

const CODE_BORDER: &str = r#"<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="D0D0D0"/><w:left w:val="single" w:sz="4" w:space="4" w:color="D0D0D0"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D0D0D0"/><w:right w:val="single" w:sz="4" w:space="4" w:color="D0D0D0"/></w:pBdr>"#;

/* -------------------------------------------------------------------------- */
/* Unit conversions                                                           */
/* -------------------------------------------------------------------------- */

/// Word stores font sizes in half-points.
fn half_points(pt: f32) -> u32 {
    let value = if pt.is_finite() { pt.max(1.0) } else { 12.0 };
    (value * 2.0).round() as u32
}

/// Word lengths are twips (1/20 pt).
fn twips(pt: f32) -> u32 {
    if pt.is_finite() {
        (pt.max(0.0) * 20.0).round() as u32
    } else {
        0
    }
}

/// 1 mm = 56.6929 twips.
fn mm_twips(mm: f32) -> u32 {
    if mm.is_finite() {
        (mm.max(0.0) * 56.6929).round() as u32
    } else {
        0
    }
}

/// 1 mm = 36000 English Metric Units (914400 EMU per inch, 25.4 mm per inch).
fn mm_emu(mm: f32) -> u32 {
    if mm.is_finite() {
        (mm.max(0.0) * 36000.0).round() as u32
    } else {
        0
    }
}

/// `w:line` with `w:lineRule="auto"` is a multiple of 240ths of a line.
fn line_spacing(multiple: f32) -> String {
    if multiple.is_finite() && multiple > 0.0 {
        let line = (multiple * 240.0).round() as u32;
        format!(r#"<w:spacing w:line="{line}" w:lineRule="auto"/>"#)
    } else {
        String::new()
    }
}

fn jc_value(align: &str) -> Option<&'static str> {
    match align {
        "center" => Some("center"),
        "right" => Some("right"),
        _ => None,
    }
}

/// `#rrggbb` (or a fallback colour) as Word's bare hex.
fn hex_no_hash(value: &str) -> String {
    value.trim().trim_start_matches('#').to_ascii_uppercase()
}

fn fonts_attrs(family: &str) -> String {
    let family = family.trim();
    if family.is_empty() {
        return String::new();
    }
    let family = escape(family);
    format!(
        r#"<w:rFonts w:ascii="{family}" w:hAnsi="{family}" w:eastAsia="{family}" w:cs="{family}"/>"#
    )
}

fn list_indent(level: u8) -> u32 {
    720 * (u32::from(level) + 1)
}

/* -------------------------------------------------------------------------- */
/* Document model walk                                                        */
/* -------------------------------------------------------------------------- */

struct MediaPart {
    rel_id: u32,
    name: String,
    data: Vec<u8>,
    extension: String,
}

struct LinkRel {
    rel_id: u32,
    href: String,
}

/// Accumulates the body while handing out relationship ids for the media and
/// hyperlink parts that end up in `word/_rels/document.xml.rels`.
struct Docx {
    images: Vec<MediaPart>,
    links: Vec<LinkRel>,
    /// One `w:num` per list, so a later list restarts instead of continuing the
    /// previous counter. The bool records the abstract definition to point at.
    numbers: Vec<(u32, bool)>,
    next_num: u32,
    next_rel: u32,
    next_docpr: u32,
    content_emu: u32,
    content_twips: u32,
    image_max_ratio: f32,
    table_borders: bool,
    header_fill: String,
}

impl Docx {
    fn new(styles: &ExportStyles) -> Self {
        let (page_w, _) = styles.page_mm();
        let content_mm = (page_w - styles.margin_left - styles.margin_right).max(10.0);
        let image_max_ratio = if styles.image_max_width > 0.0 {
            styles.image_max_width.clamp(10.0, 100.0) / 100.0
        } else {
            1.0
        };

        Self {
            images: Vec::new(),
            links: Vec::new(),
            numbers: Vec::new(),
            next_num: 1,
            next_rel: FIRST_FREE_REL,
            next_docpr: 1,
            content_emu: mm_emu(content_mm),
            content_twips: mm_twips(content_mm),
            image_max_ratio,
            table_borders: styles.table_borders,
            header_fill: hex_no_hash(&color_or(&styles.table_header_fill, "#F2F2F2")),
        }
    }

    fn alloc_rel(&mut self) -> u32 {
        let id = self.next_rel;
        self.next_rel += 1;
        id
    }

    fn alloc_number(&mut self, ordered: bool) -> u32 {
        let id = self.next_num;
        self.next_num += 1;
        self.numbers.push((id, ordered));
        id
    }

    fn render_blocks(&mut self, blocks: &[Block], level: u8, quote: bool) -> String {
        let mut out = String::new();
        for block in blocks {
            out.push_str(&self.render_block(block, level, quote));
        }
        out
    }

    fn render_block(&mut self, block: &Block, level: u8, quote: bool) -> String {
        match block {
            Block::Heading {
                level: heading_level,
                align,
                runs,
            } => {
                let heading_level = (*heading_level).clamp(1, 6);
                let style = format!("Heading{heading_level}");
                self.paragraph(runs, align, Some(&style), None, None)
            }
            Block::Paragraph { align, runs } => {
                let style = if quote { Some("Quote") } else { None };
                self.paragraph(runs, align, style, None, None)
            }
            Block::Code { text, .. } => code_paragraph(text),
            Block::Quote { blocks } => self.render_blocks(blocks, level, true),
            Block::List { ordered, items } => self.render_list(*ordered, items, level, None),
            Block::Table { aligns, head, rows } => self.table(aligns, head, rows),
            Block::Hr => HR_XML.to_string(),
            Block::MathBlock { tex, mathml } => self.math_paragraph(tex, mathml),
            Block::Image {
                align,
                src,
                file,
                ratio,
                caption,
            } => self.render_image(align, src, file.as_deref(), *ratio, caption),
        }
    }

    /// Renders a list.
    ///
    /// `num_id` is the numbering instance to continue, or `None` to start a new
    /// one. A nested list of the same kind joins its parent's instance, which is
    /// what makes the outline numbers nest — `1.`, then `1.1` under it. Switching
    /// kind (a bullet list inside an ordered one) needs its own instance, because
    /// a level's number format belongs to the abstract definition.
    fn render_list(
        &mut self,
        ordered: bool,
        items: &[ListItem],
        level: u8,
        num_id: Option<u32>,
    ) -> String {
        let num_id = num_id.unwrap_or_else(|| self.alloc_number(ordered));
        let ilvl = level.min(8);
        let mut out = String::new();

        for item in items {
            // A task item carries its own checkbox, which takes the place of the
            // bullet; it still keeps the indent, just not the numbering.
            let is_task = item.checked.is_some();
            let marker = if is_task {
                "☑ "
            } else {
                ""
            };
            let marker = if item.checked == Some(false) {
                "☐ "
            } else {
                marker
            };
            let with_box = |runs: &[Inline]| -> Vec<Inline> {
                if marker.is_empty() {
                    runs.to_vec()
                } else {
                    std::iter::once(Inline::Text {
                        v: marker.to_string(),
                    })
                    .chain(runs.iter().cloned())
                    .collect()
                }
            };
            let indent = Some(list_indent(level));

            if item.blocks.is_empty() {
                let num = if is_task { None } else { Some((num_id, ilvl)) };
                let ind = if is_task { indent } else { None };
                out.push_str(&self.paragraph(&with_box(&[]), "left", None, num, ind));
                continue;
            }

            let mut first = true;
            for block in &item.blocks {
                match block {
                    Block::List {
                        ordered: nested_ordered,
                        items: nested_items,
                    } => {
                        let nested_num = if *nested_ordered == ordered {
                            Some(num_id)
                        } else {
                            None
                        };
                        out.push_str(&self.render_list(
                            *nested_ordered,
                            nested_items,
                            level.saturating_add(1),
                            nested_num,
                        ));
                    }
                    Block::Paragraph { align, runs } => {
                        // Only the opening paragraph of a task item repeats the
                        // box; a wrapped second paragraph reads as continuation.
                        let runs = if first { with_box(runs) } else { runs.to_vec() };
                        let num = if first && !is_task {
                            Some((num_id, ilvl))
                        } else {
                            None
                        };
                        let ind = if first && !is_task { None } else { indent };
                        out.push_str(&self.paragraph(&runs, align, None, num, ind));
                        first = false;
                    }
                    other => out.push_str(&self.render_block(other, level, false)),
                }
            }
        }

        out
    }

    fn paragraph(
        &mut self,
        runs: &[Inline],
        align: &str,
        style: Option<&str>,
        num: Option<(u32, u8)>,
        ind_left: Option<u32>,
    ) -> String {
        let mut ppr = String::new();
        if let Some(style) = style {
            ppr.push_str(&format!(r#"<w:pStyle w:val="{style}"/>"#));
        }
        if let Some((num_id, ilvl)) = num {
            ppr.push_str(&format!(
                r#"<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr>"#
            ));
        }
        if let Some(left) = ind_left {
            ppr.push_str(&format!(r#"<w:ind w:left="{left}"/>"#));
        }
        if let Some(jc) = jc_value(align) {
            ppr.push_str(&format!(r#"<w:jc w:val="{jc}"/>"#));
        }

        let ppr = if ppr.is_empty() {
            String::new()
        } else {
            format!("<w:pPr>{ppr}</w:pPr>")
        };
        let runs = self.runs_xml(runs);
        format!("<w:p>{ppr}{runs}</w:p>")
    }

    fn runs_xml(&mut self, runs: &[Inline]) -> String {
        let mut out = String::new();
        // The formatting contributed by raw inline HTML, which applies to
        // everything between the opening and closing tag.
        let mut markup = HtmlFormat::default();

        for run in runs {
            if let Inline::Html { v } = run {
                markup.apply(v);
                continue;
            }

            // The tag's own properties come after the run's, which keeps them in
            // the order Word's schema expects: rStyle, rFonts, b, i, strike, sz,
            // highlight, u, vertAlign.
            let with = |base: &str| format!("{base}{}", markup.xml());

            match run {
                Inline::Text { v } => out.push_str(&run_xml(v, &with(""))),
                Inline::Bold { v } => out.push_str(&run_xml(v, &with("<w:b/><w:bCs/>"))),
                Inline::Italic { v } => out.push_str(&run_xml(v, &with("<w:i/><w:iCs/>"))),
                Inline::Strike { v } => out.push_str(&run_xml(v, &with("<w:strike/>"))),
                Inline::Code { v } => {
                    out.push_str(&run_xml(v, &with(r#"<w:rStyle w:val="CodeChar"/>"#)))
                }
                Inline::Link { v, href } => {
                    let rel_id = self.alloc_rel();
                    self.links.push(LinkRel {
                        rel_id,
                        href: href.clone(),
                    });
                    let text = run_xml(v, &with(r#"<w:rStyle w:val="Hyperlink"/>"#));
                    out.push_str(&format!(r#"<w:hyperlink r:id="rId{rel_id}">{text}</w:hyperlink>"#));
                }
                // Inline pictures are not part of the media walk; keep the alt text.
                Inline::Image { v, src, .. } => {
                    let alt = if v.trim().is_empty() { src.as_str() } else { v.as_str() };
                    out.push_str(&run_xml(alt, &with("")));
                }
                // A break inside a run sequence, not a paragraph of its own.
                Inline::Br => out.push_str("<w:r><w:br/></w:r>"),
                // Word has no MathML: an equation has to arrive as OMML, which is
                // what `omml` converts the frontend's rendering into. A source it
                // cannot read still goes in, as the LaTeX the reader wrote.
                Inline::Math { tex, mathml } => match omml::to_omml(mathml) {
                    Some(equation) => out.push_str(&equation),
                    None => out.push_str(&run_xml(&format!("${tex}$"), "")),
                },
                // Handled before the match: it only changes what follows.
                Inline::Html { .. } => {}
            }
        }
        out
    }

    fn table(
        &mut self,
        aligns: &[Option<String>],
        head: &[Vec<Inline>],
        rows: &[Vec<Vec<Inline>>],
    ) -> String {
        let cols = head
            .len()
            .max(rows.iter().map(Vec::len).max().unwrap_or(0))
            .max(1);
        let col_w = self.content_twips / cols as u32;
        let borders = if self.table_borders { TABLE_BORDERS } else { "" };
        let fill = self.header_fill.clone();

        let mut out = String::new();
        out.push_str("<w:tbl><w:tblPr>");
        out.push_str(&format!(
            r#"<w:tblW w:w="{}" w:type="dxa"/>"#,
            self.content_twips
        ));
        out.push_str(borders);
        out.push_str("</w:tblPr><w:tblGrid>");
        for _ in 0..cols {
            out.push_str(&format!(r#"<w:gridCol w:w="{col_w}"/>"#));
        }
        out.push_str("</w:tblGrid>");

        if !head.is_empty() {
            out.push_str(&self.table_row(head, aligns, Some(&fill), col_w, cols));
        }
        for row in rows {
            out.push_str(&self.table_row(row, aligns, None, col_w, cols));
        }

        out.push_str("</w:tbl>");
        out
    }

    fn table_row(
        &mut self,
        cells: &[Vec<Inline>],
        aligns: &[Option<String>],
        fill: Option<&str>,
        col_w: u32,
        cols: usize,
    ) -> String {
        let mut out = String::from("<w:tr>");
        for index in 0..cols {
            let cell = cells.get(index).map(Vec::as_slice).unwrap_or(&[]);
            let align = aligns
                .get(index)
                .and_then(|value| value.as_deref())
                .unwrap_or("left");
            let shd = match fill {
                Some(fill) => format!(
                    r#"<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>"#
                ),
                None => String::new(),
            };
            let paragraph = self.paragraph(cell, align, None, None, None);
            out.push_str(&format!(
                r#"<w:tc><w:tcPr><w:tcW w:w="{col_w}" w:type="dxa"/>{shd}</w:tcPr>{paragraph}</w:tc>"#
            ));
        }
        out.push_str("</w:tr>");
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn render_image(
        &mut self,
        align: &str,
        src: &str,
        file: Option<&str>,
        ratio: Option<f32>,
        caption: &str,
    ) -> String {
        if let Some((data, extension, (px_w, px_h))) = file.and_then(embed_image) {
            let rel_id = self.alloc_rel();
            let index = self.images.len() + 1;
            let name = format!("image{index}.{extension}");
            let (cx, cy) = self.image_extent(px_w, px_h, ratio.unwrap_or(1.0));
            let docpr = self.next_docpr;
            self.next_docpr += 1;
            let alt = if caption.trim().is_empty() { src } else { caption };

            let mut out = drawing_paragraph(align, cx, cy, rel_id, docpr, &name, alt);
            self.images.push(MediaPart {
                rel_id,
                name,
                data,
                extension,
            });

            if !caption.trim().is_empty() {
                let caption_run = Inline::Text {
                    v: caption.to_string(),
                };
                out.push_str(&self.paragraph(
                    &[caption_run],
                    "center",
                    Some("Caption"),
                    None,
                    None,
                ));
            }
            out
        } else {
            let label = if caption.trim().is_empty() {
                format!("[图片：{src}]")
            } else {
                caption.to_string()
            };
            let run = Inline::Text { v: label };
            self.paragraph(&[run], align, None, None, None)
        }
    }

    /// A display formula: a centred paragraph holding one equation.
    ///
    /// `<m:oMathPara>` is Word's own element for a display equation, but it is
    /// only valid where block-level content is. A paragraph is valid inside a
    /// list item, a quote and a table cell as well, and looks the same.
    fn math_paragraph(&mut self, tex: &str, mathml: &str) -> String {
        match omml::to_omml(mathml) {
            Some(equation) => {
                format!(r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr>{equation}</w:p>"#)
            }
            None => {
                let run = Inline::Text {
                    v: format!("$${tex}$$"),
                };
                self.paragraph(&[run], "center", None, None, None)
            }
        }
    }

    fn image_extent(&self, px_w: u32, px_h: u32, ratio: f32) -> (u32, u32) {
        let natural_w = f64::from(px_w.max(1)) * 9525.0;
        let natural_h = f64::from(px_h.max(1)) * 9525.0;
        let max_w = f64::from(self.content_emu) * f64::from(self.image_max_ratio);
        // Fit into the text column first, then apply the scale the user dragged:
        // that is the order the editor itself uses, so the printed size matches
        // what was on screen.
        let fit = if natural_w > max_w { max_w / natural_w } else { 1.0 };
        let scale = fit * f64::from(ratio.clamp(0.01, 1.0));
        let cx = (natural_w * scale).round().max(1.0) as u32;
        let cy = (natural_h * scale).round().max(1.0) as u32;
        (cx, cy)
    }
}

/* -------------------------------------------------------------------------- */
/* Package parts                                                              */
/* -------------------------------------------------------------------------- */

/// Entry point: walks `blocks` and returns a complete ZIP package.
pub fn build_docx(blocks: &[Block], styles: &ExportStyles) -> AppResult<Vec<u8>> {
    let mut docx = Docx::new(styles);

    let mut body = String::new();
    if !styles.title.trim().is_empty() {
        let title_run = Inline::Text {
            v: styles.title.clone(),
        };
        body.push_str(&docx.paragraph(&[title_run], "center", Some("Title"), None, None));
    }
    body.push_str(&docx.render_blocks(blocks, 0, false));

    let document = build_document(&body, styles);
    let style_sheet = build_styles(styles);
    let numbering = build_numbering(&docx);
    let content_types = build_content_types(&docx);
    let document_rels = build_document_rels(&docx);
    let package_rels = build_root_rels();

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    write_part(&mut zip, "[Content_Types].xml", content_types.as_bytes(), options)?;
    write_part(&mut zip, "_rels/.rels", package_rels.as_bytes(), options)?;
    write_part(&mut zip, "word/document.xml", document.as_bytes(), options)?;
    write_part(&mut zip, "word/styles.xml", style_sheet.as_bytes(), options)?;
    write_part(&mut zip, "word/numbering.xml", numbering.as_bytes(), options)?;
    write_part(
        &mut zip,
        "word/_rels/document.xml.rels",
        document_rels.as_bytes(),
        options,
    )?;
    for image in &docx.images {
        let path = format!("word/media/{}", image.name);
        write_part(&mut zip, &path, &image.data, options)?;
    }

    let cursor = zip.finish().map_err(zip_error)?;
    Ok(cursor.into_inner())
}

fn build_document(body: &str, styles: &ExportStyles) -> String {
    let (page_w, page_h) = styles.page_mm();
    let sect = format!(
        r#"<w:sectPr><w:pgSz w:w="{w}" w:h="{h}"/><w:pgMar w:top="{top}" w:right="{right}" w:bottom="{bottom}" w:left="{left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#,
        w = mm_twips(page_w),
        h = mm_twips(page_h),
        top = mm_twips(styles.margin_top),
        right = mm_twips(styles.margin_right),
        bottom = mm_twips(styles.margin_bottom),
        left = mm_twips(styles.margin_left),
    );
    format!(
        r#"{XML_DECL}<w:document xmlns:w="{NS_W}" xmlns:m="{NS_M}" xmlns:r="{NS_R}" xmlns:wp="{NS_WP}" xmlns:a="{NS_A}" xmlns:pic="{NS_PIC}"><w:body>{body}{sect}</w:body></w:document>"#
    )
}

fn build_root_rels() -> String {
    format!(
        r#"{XML_DECL}<Relationships xmlns="{NS_PKG_REL}"><Relationship Id="rId1" Type="{REL_TYPES}/officeDocument" Target="word/document.xml"/></Relationships>"#
    )
}

fn build_content_types(docx: &Docx) -> String {
    let mut out = String::new();
    out.push_str(XML_DECL);
    out.push_str(&format!(r#"<Types xmlns="{NS_CT}">"#));
    out.push_str(
        r#"<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>"#,
    );
    out.push_str(r#"<Default Extension="xml" ContentType="application/xml"/>"#);
    out.push_str(
        r#"<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#,
    );
    out.push_str(
        r#"<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#,
    );
    out.push_str(
        r#"<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#,
    );

    let mut declared: BTreeSet<&str> = BTreeSet::new();
    for image in &docx.images {
        if let Some(content_type) = image_content_type(&image.extension) {
            if declared.insert(image.extension.as_str()) {
                out.push_str(&format!(
                    r#"<Default Extension="{}" ContentType="{content_type}"/>"#,
                    image.extension
                ));
            }
        }
    }

    out.push_str("</Types>");
    out
}

fn build_document_rels(docx: &Docx) -> String {
    let mut out = String::new();
    out.push_str(XML_DECL);
    out.push_str(&format!(r#"<Relationships xmlns="{NS_PKG_REL}">"#));
    out.push_str(&format!(
        r#"<Relationship Id="rId{REL_STYLES}" Type="{REL_TYPES}/styles" Target="styles.xml"/>"#
    ));
    out.push_str(&format!(
        r#"<Relationship Id="rId{REL_NUMBERING}" Type="{REL_TYPES}/numbering" Target="numbering.xml"/>"#
    ));
    for image in &docx.images {
        out.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="{REL_TYPES}/image" Target="media/{}"/>"#,
            image.rel_id, image.name
        ));
    }
    for link in &docx.links {
        out.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="{REL_TYPES}/hyperlink" Target="{}" TargetMode="External"/>"#,
            link.rel_id,
            escape(&link.href)
        ));
    }
    out.push_str("</Relationships>");
    out
}

fn build_styles(styles: &ExportStyles) -> String {
    let body_sz = half_points(styles.body_font_size);
    let body_fonts = fonts_attrs(styles.body_font.trim());
    let body_size = format!(r#"<w:sz w:val="{body_sz}"/><w:szCs w:val="{body_sz}"/>"#);
    let body_line = line_spacing(styles.body_line_height);

    let mut out = String::new();
    out.push_str(XML_DECL);
    out.push_str(&format!(r#"<w:styles xmlns:w="{NS_W}">"#));

    out.push_str("<w:docDefaults><w:rPrDefault><w:rPr>");
    out.push_str(&body_fonts);
    out.push_str(&body_size);
    out.push_str("</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>");
    out.push_str(&body_line);
    out.push_str("</w:pPr></w:pPrDefault></w:docDefaults>");

    out.push_str(&format!(
        r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>{body_line}</w:pPr><w:rPr>{body_fonts}{body_size}</w:rPr></w:style>"#
    ));

    let heading_fonts = fonts_attrs(styles.heading_family().trim());
    let heading_color = hex_no_hash(&color_or(&styles.heading_color, "#1A1A1A"));
    let heading_bold = if styles.heading_bold {
        "<w:b/><w:bCs/>"
    } else {
        ""
    };

    for level in 1..=6u8 {
        let sz = half_points(styles.heading_size(level));
        let (before, after) = styles.heading_spacing(level);
        out.push_str(&format!(
            r#"<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="{before_tw}" w:after="{after_tw}"/><w:outlineLvl w:val="{outline}"/></w:pPr><w:rPr>{heading_fonts}{heading_bold}<w:color w:val="{heading_color}"/><w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/></w:rPr></w:style>"#,
            before_tw = twips(before),
            after_tw = twips(after),
            outline = level - 1,
        ));
    }

    let code_font = if styles.code_font.trim().is_empty() {
        "Consolas"
    } else {
        styles.code_font.trim()
    };
    let code_fonts = fonts_attrs(code_font);
    let code_sz = half_points(styles.code_font_size);
    let code_bg = hex_no_hash(&color_or(&styles.code_background, "#F5F5F5"));
    out.push_str(&format!(
        r#"<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>{CODE_BORDER}<w:shd w:val="clear" w:color="auto" w:fill="{code_bg}"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr>{code_fonts}<w:noProof/><w:sz w:val="{code_sz}"/><w:szCs w:val="{code_sz}"/></w:rPr></w:style>"#
    ));

    out.push_str(
        r#"<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:color w:val="595959"/></w:rPr></w:style>"#,
    );

    let caption_sz = half_points(styles.body_font_size);
    out.push_str(&format!(
        r#"<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="120"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="808080"/><w:sz w:val="{caption_sz}"/><w:szCs w:val="{caption_sz}"/></w:rPr></w:style>"#
    ));

    out.push_str(&format!(
        r#"<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr>{code_fonts}<w:sz w:val="{code_sz}"/><w:szCs w:val="{code_sz}"/><w:shd w:val="clear" w:color="auto" w:fill="{code_bg}"/></w:rPr></w:style>"#
    ));

    out.push_str(
        r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1A56A8"/><w:u w:val="single"/></w:rPr></w:style>"#,
    );

    if !styles.title.trim().is_empty() {
        let title_sz = half_points(styles.heading_size(1));
        out.push_str(&format!(
            r#"<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr>{heading_fonts}{heading_bold}<w:color w:val="{heading_color}"/><w:sz w:val="{title_sz}"/><w:szCs w:val="{title_sz}"/></w:rPr></w:style>"#
        ));
    }

    out.push_str("</w:styles>");
    out
}

fn build_numbering(docx: &Docx) -> String {
    let mut out = String::new();
    out.push_str(XML_DECL);
    out.push_str(&format!(r#"<w:numbering xmlns:w="{NS_W}">"#));
    out.push_str(&format!(
        r#"<w:abstractNum w:abstractNumId="{ABSTRACT_BULLET}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum>"#,
        bullet_levels()
    ));
    out.push_str(&format!(
        r#"<w:abstractNum w:abstractNumId="{ABSTRACT_DECIMAL}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum>"#,
        decimal_levels()
    ));

    if docx.numbers.is_empty() {
        out.push_str(&format!(
            r#"<w:num w:numId="1"><w:abstractNumId w:val="{ABSTRACT_BULLET}"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="{ABSTRACT_DECIMAL}"/></w:num>"#
        ));
    } else {
        for (num_id, ordered) in &docx.numbers {
            let abstract_id = if *ordered { ABSTRACT_DECIMAL } else { ABSTRACT_BULLET };
            out.push_str(&format!(
                r#"<w:num w:numId="{num_id}"><w:abstractNumId w:val="{abstract_id}"/></w:num>"#
            ));
        }
    }

    out.push_str("</w:numbering>");
    out
}

fn bullet_levels() -> String {
    const MARKS: [&str; 3] = ["•", "o", "▪"];
    let mut out = String::new();
    for ilvl in 0..9u32 {
        let left = 720 * (ilvl + 1);
        let mark = MARKS[(ilvl as usize) % MARKS.len()];
        out.push_str(&format!(
            r#"<w:lvl w:ilvl="{ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{mark}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{left}" w:hanging="360"/></w:pPr></w:lvl>"#
        ));
    }
    out
}

/// The ordered-list levels, numbered after their parents: `1.`, `1.1`, `1.1.1`.
///
/// `%N` in Word's level text is the counter of level N-1, so a level that names
/// every ancestor produces the hierarchical numbering an outline or a thesis
/// expects. Numbering each level on its own (`%N.` alone) would print a bare `1.`
/// at every depth, making the nesting invisible in the printed document.
fn decimal_levels() -> String {
    let mut out = String::new();
    for ilvl in 0..9u32 {
        let left = 720 * (ilvl + 1);
        let text: Vec<String> = (1..=ilvl + 1).map(|n| format!("%{n}")).collect();
        let text = text.join(".");
        out.push_str(&format!(
            r#"<w:lvl w:ilvl="{ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="{text}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{left}" w:hanging="360"/></w:pPr></w:lvl>"#
        ));
    }
    out
}

/* -------------------------------------------------------------------------- */
/* Run and drawing XML                                                        */
/* -------------------------------------------------------------------------- */

/// The character formatting a run of raw inline HTML asks for.
///
/// Word has no notion of `<kbd>` or `<mark>`, so each tag is mapped onto the run
/// property that means the same thing on paper. Tags with no equivalent (a
/// `<span>`, an `<abbr>`) contribute nothing, and their contents survive.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
struct HtmlFormat {
    bold: bool,
    italic: bool,
    strike: bool,
    underline: bool,
    highlight: bool,
    monospace: bool,
    small: bool,
    superscript: bool,
    subscript: bool,
}

impl HtmlFormat {
    /// Folds one tag in; a closing tag takes the property back out.
    fn apply(&mut self, tag: &str) {
        let closing = tag.starts_with("</");
        let name = tag
            .trim_start_matches('<')
            .trim_start_matches('/')
            .trim_end_matches('>')
            .trim_end_matches('/')
            .trim()
            .to_ascii_lowercase();
        let on = !closing;

        match name.as_str() {
            "b" | "strong" => self.bold = on,
            "i" | "em" | "cite" => self.italic = on,
            "del" | "s" => self.strike = on,
            "u" | "ins" => self.underline = on,
            "mark" => self.highlight = on,
            "kbd" | "code" => self.monospace = on,
            "small" => self.small = on,
            "sup" => self.superscript = on,
            "sub" => self.subscript = on,
            _ => {}
        }
    }

    /// The run properties, in the order Word's schema requires.
    fn xml(&self) -> String {
        let mut out = String::new();
        if self.monospace {
            out.push_str(
                r#"<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>"#,
            );
        }
        if self.bold {
            out.push_str("<w:b/><w:bCs/>");
        }
        if self.italic {
            out.push_str("<w:i/><w:iCs/>");
        }
        if self.strike {
            out.push_str("<w:strike/>");
        }
        if self.small {
            out.push_str(r#"<w:sz w:val="20"/><w:szCs w:val="20"/>"#);
        }
        if self.highlight {
            out.push_str(r#"<w:highlight w:val="yellow"/>"#);
        }
        if self.underline {
            out.push_str(r#"<w:u w:val="single"/>"#);
        }
        if self.superscript {
            out.push_str(r#"<w:vertAlign w:val="superscript"/>"#);
        }
        if self.subscript {
            out.push_str(r#"<w:vertAlign w:val="subscript"/>"#);
        }
        out
    }
}

fn run_xml(text: &str, props: &str) -> String {
    let rpr = if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{props}</w:rPr>")
    };
    format!(
        r#"<w:r>{rpr}<w:t xml:space="preserve">{}</w:t></w:r>"#,
        escape(text)
    )
}

/// One paragraph per code block; each source line becomes its own `<w:br/>`-separated
/// run so Word keeps the leading whitespace and the blank lines.
fn code_paragraph(text: &str) -> String {
    let mut runs = String::new();
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 {
            runs.push_str("<w:r><w:br/></w:r>");
        }
        let line = line.strip_suffix('\r').unwrap_or(line);
        runs.push_str(&format!(
            r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
            escape(line)
        ));
    }
    format!(r#"<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>{runs}</w:p>"#)
}

#[allow(clippy::too_many_arguments)]
fn drawing_paragraph(
    align: &str,
    cx: u32,
    cy: u32,
    rel_id: u32,
    docpr: u32,
    name: &str,
    alt: &str,
) -> String {
    let jc = match jc_value(align) {
        Some(value) => format!(r#"<w:pPr><w:jc w:val="{value}"/></w:pPr>"#),
        None => String::new(),
    };
    format!(
        r#"<w:p>{jc}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{docpr}" name="Picture {docpr}" descr="{descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{pic_name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#,
        descr = escape(alt),
        pic_name = escape(name),
    )
}

fn embed_image(file: &str) -> Option<(Vec<u8>, String, (u32, u32))> {
    let (data, extension) = read_image(file)?;
    image_content_type(&extension)?;
    // Formats other than PNG/JPEG have no header reader here; Word still needs
    // an extent, so fall back to a nominal size and keep the aspect by proxy.
    let size = image_size(&data).unwrap_or((400, 300));
    Some((data, extension, size))
}

fn image_content_type(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/* -------------------------------------------------------------------------- */
/* ZIP plumbing                                                               */
/* -------------------------------------------------------------------------- */

fn zip_error(error: zip::result::ZipError) -> AppError {
    AppError::Message(format!("生成 Word 文档失败：{error}"))
}

fn write_part<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    data: &[u8],
    options: SimpleFileOptions,
) -> AppResult<()> {
    zip.start_file(name, options).map_err(zip_error)?;
    zip.write_all(data)?;
    Ok(())
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Read};
    use std::path::PathBuf;

    use zip::ZipArchive;

    use super::*;

    /// A 2×2 PNG header on disk, deleted when the test ends.
    struct PngFile(PathBuf);

    impl PngFile {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "qingjian-docx-{}-{tag}.png",
                std::process::id()
            ));
            let mut data = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
            data.extend_from_slice(&13u32.to_be_bytes());
            data.extend_from_slice(b"IHDR");
            data.extend_from_slice(&2u32.to_be_bytes());
            data.extend_from_slice(&2u32.to_be_bytes());
            data.extend_from_slice(&[8, 6, 0, 0, 0]);
            std::fs::write(&path, data).expect("write png");
            Self(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().unwrap_or_default()
        }
    }

    impl Drop for PngFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn sample_styles() -> ExportStyles {
        ExportStyles {
            body_font: "SimSun".into(),
            body_font_size: 12.0,
            body_line_height: 1.5,
            heading_font: "SimHei".into(),
            heading_bold: true,
            heading_color: "#1A1A1A".into(),
            heading_sizes: vec![30.0, 24.0, 18.0, 16.0, 14.0, 12.0],
            heading_space_before: 12.0,
            heading_space_after: 6.0,
            code_font: "Consolas".into(),
            code_font_size: 10.5,
            code_background: "#F5F5F5".into(),
            page_size: "a4".into(),
            margin_top: 25.4,
            margin_bottom: 25.4,
            margin_left: 31.7,
            margin_right: 31.7,
            table_borders: false,
            table_header_fill: "#F2F2F2".into(),
            image_max_width: 100.0,
            title: "测试文档".into(),
        }
    }

    fn mixed_blocks(image_file: Option<&str>) -> Vec<Block> {
        let paragraph = |text: &str| Block::Paragraph {
            align: "left".into(),
            runs: vec![Inline::Text { v: text.into() }],
        };

        vec![
            Block::Heading {
                level: 2,
                align: "left".into(),
                runs: vec![Inline::Text {
                    v: "第二章 系统设计".into(),
                }],
            },
            Block::Paragraph {
                align: "left".into(),
                runs: vec![
                    Inline::Text { v: "包含 ".into() },
                    Inline::Bold { v: "粗体".into() },
                    Inline::Text { v: " 和 ".into() },
                    Inline::Italic { v: "斜体".into() },
                    Inline::Text { v: " 以及 ".into() },
                    Inline::Code { v: "code()".into() },
                    Inline::Text { v: "，还有 ".into() },
                    Inline::Link {
                        v: "链接".into(),
                        href: "https://example.com".into(),
                    },
                ],
            },
            Block::Code {
                lang: "rust".into(),
                text: "fn main() {\n    println!(\"hi\");\n}".into(),
            },
            Block::Quote {
                blocks: vec![paragraph("引用内容")],
            },
            Block::List {
                ordered: false,
                items: vec![
                    ListItem {
                        blocks: vec![paragraph("第一项")],
                        checked: None,
                    },
                    ListItem {
                        blocks: vec![
                            paragraph("第二项"),
                            Block::List {
                                ordered: true,
                                items: vec![ListItem {
                                    blocks: vec![paragraph("嵌套项")],
                                    checked: None,
                                }],
                            },
                        ],
                        checked: None,
                    },
                ],
            },
            Block::List {
                ordered: true,
                items: vec![ListItem {
                    blocks: vec![paragraph("有序一")],
                    checked: None,
                }],
            },
            Block::Table {
                aligns: vec![Some("left".into()), Some("right".into())],
                head: vec![
                    vec![Inline::Text { v: "列A".into() }],
                    vec![Inline::Text { v: "列B".into() }],
                ],
                rows: vec![vec![
                    vec![Inline::Text { v: "1".into() }],
                    vec![Inline::Text { v: "2".into() }],
                ]],
            },
            Block::Hr,
            Block::Image {
                align: "center".into(),
                src: "assets/pic.png".into(),
                file: image_file.map(str::to_string),
                ratio: None,
                caption: "图 2-1".into(),
            },
        ]
    }

    fn part(bytes: &[u8], name: &str) -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes.to_vec())).expect("open zip");
        let mut file = archive.by_name(name).unwrap_or_else(|_| panic!("missing {name}"));
        let mut text = String::new();
        file.read_to_string(&mut text).expect("read part");
        text
    }

    fn assert_balanced(xml: &str, open: &str, close: &str) {
        let opens = xml.matches(open).count();
        let closes = xml.matches(close).count();
        assert_eq!(opens, closes, "unbalanced {open} / {close}: {opens} vs {closes}");
        assert!(opens > 0, "expected at least one {open}");
    }

    #[test]
    fn builds_zip_package() {
        let png = PngFile::new("magic");
        let bytes = build_docx(&mixed_blocks(Some(png.path())), &sample_styles()).expect("docx");
        assert!(bytes.starts_with(b"PK\x03\x04"), "missing zip magic");
    }

    #[test]
    fn package_contains_required_parts() {
        let png = PngFile::new("parts");
        let bytes = build_docx(&mixed_blocks(Some(png.path())), &sample_styles()).expect("docx");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("open zip");
        for name in [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/_rels/document.xml.rels",
            "word/media/image1.png",
        ] {
            assert!(archive.by_name(name).is_ok(), "missing part {name}");
        }
    }

    #[test]
    fn heading_uses_heading_style() {
        let bytes = build_docx(&mixed_blocks(None), &sample_styles()).expect("docx");
        let document = part(&bytes, "word/document.xml");
        assert!(document.contains("第二章 系统设计"));
        assert!(document.contains(r#"<w:pStyle w:val="Heading2"/>"#));
    }

    #[test]
    fn heading_style_carries_configured_size() {
        let bytes = build_docx(&mixed_blocks(None), &sample_styles()).expect("docx");
        let styles = part(&bytes, "word/styles.xml");
        let heading = styles
            .split(r#"w:styleId="Heading2""#)
            .nth(1)
            .expect("Heading2 style");
        let block = &heading[..heading.find("</w:style>").expect("style end")];
        assert!(
            block.contains(r#"<w:sz w:val="48"/>"#),
            "24pt heading should be 48 half-points, got: {block}"
        );
    }

    #[test]
    fn table_borders_follow_setting() {
        let blocks = vec![Block::Table {
            aligns: vec![None],
            head: vec![vec![Inline::Text { v: "表头".into() }]],
            rows: vec![vec![vec![Inline::Text { v: "值".into() }]]],
        }];

        let mut styles = sample_styles();
        styles.table_borders = false;
        let without = part(&build_docx(&blocks, &styles).expect("docx"), "word/document.xml");
        assert!(!without.contains("w:tblBorders"));

        styles.table_borders = true;
        let with = part(&build_docx(&blocks, &styles).expect("docx"), "word/document.xml");
        assert!(with.contains("w:tblBorders"));
    }

    #[test]
    fn each_list_restarts_numbering() {
        let item = |text: &str| ListItem {
            blocks: vec![Block::Paragraph {
                align: "left".into(),
                runs: vec![Inline::Text { v: text.into() }],
            }],
            checked: None,
        };
        let blocks = vec![
            Block::List {
                ordered: true,
                items: vec![item("甲")],
            },
            Block::List {
                ordered: true,
                items: vec![item("乙")],
            },
        ];

        let bytes = build_docx(&blocks, &sample_styles()).expect("docx");
        let document = part(&bytes, "word/document.xml");
        assert!(document.contains(r#"<w:numId w:val="1"/>"#));
        assert!(document.contains(r#"<w:numId w:val="2"/>"#));
        let numbering = part(&bytes, "word/numbering.xml");
        assert!(numbering.contains(r#"<w:num w:numId="1">"#));
        assert!(numbering.contains(r#"<w:num w:numId="2">"#));
    }

    #[test]
    fn nested_ordered_lists_continue_one_numbering_instance() {
        let item = |text: &str| ListItem {
            blocks: vec![Block::Paragraph {
                align: "left".into(),
                runs: vec![Inline::Text { v: text.into() }],
            }],
            checked: None,
        };

        let nested = Block::List {
            ordered: true,
            items: vec![item("背景"), item("目标")],
        };
        let blocks = vec![Block::List {
            ordered: true,
            items: vec![
                ListItem {
                    blocks: vec![item("第一章").blocks.remove(0), nested],
                    checked: None,
                },
                item("第二章"),
            ],
        }];

        let bytes = build_docx(&blocks, &sample_styles()).expect("docx");
        let document = part(&bytes, "word/document.xml");

        // One instance for both levels: the nested items are level 1 of the same
        // list, not a list of their own.
        assert_eq!(document.matches(r#"<w:numId w:val="1"/>"#).count(), 4);
        assert!(!document.contains(r#"<w:numId w:val="2"/>"#), "{document}");
        assert!(
            document.contains(r#"<w:ilvl w:val="1"/><w:numId w:val="1"/>"#),
            "{document}"
        );

        let numbering = part(&bytes, "word/numbering.xml");
        assert!(numbering.contains(r#"<w:num w:numId="1">"#));
        assert!(!numbering.contains(r#"<w:num w:numId="2">"#));

        // The level text names every ancestor, so the nesting is visible on paper
        // instead of a bare `1.` at every depth.
        assert!(numbering.contains(r#"<w:lvlText w:val="%1."/>"#), "{numbering}");
        assert!(numbering.contains(r#"<w:lvlText w:val="%1.%2."/>"#), "{numbering}");
        assert!(numbering.contains(r#"<w:lvlText w:val="%1.%2.%3."/>"#), "{numbering}");
    }

    #[test]
    fn a_bullet_list_inside_a_numbered_one_gets_its_own_instance() {
        let item = |text: &str| ListItem {
            blocks: vec![Block::Paragraph {
                align: "left".into(),
                runs: vec![Inline::Text { v: text.into() }],
            }],
            checked: None,
        };

        let blocks = vec![Block::List {
            ordered: true,
            items: vec![ListItem {
                blocks: vec![
                    item("第一章").blocks.remove(0),
                    Block::List {
                        ordered: false,
                        items: vec![item("要点")],
                    },
                ],
                checked: None,
            }],
        }];

        let numbering = part(
            &build_docx(&blocks, &sample_styles()).expect("docx"),
            "word/numbering.xml",
        );
        // Two instances, one per kind: a level's number format belongs to the
        // abstract definition, so a bullet cannot borrow an ordered list's.
        assert!(numbering.contains(r#"<w:num w:numId="1">"#));
        assert!(numbering.contains(r#"<w:num w:numId="2">"#));
    }

    #[test]
    fn inline_markup_becomes_run_properties() {
        let blocks = vec![Block::Paragraph {
            align: "left".into(),
            runs: vec![
                Inline::Html { v: "<u>".into() },
                Inline::Text { v: "下划线".into() },
                Inline::Html { v: "</u>".into() },
                Inline::Text { v: "与".into() },
                Inline::Html { v: "<mark>".into() },
                Inline::Text { v: "高亮".into() },
                Inline::Html { v: "</mark>".into() },
                Inline::Text { v: "以及 H".into() },
                Inline::Html { v: "<sub>".into() },
                Inline::Text { v: "2".into() },
                Inline::Html { v: "</sub>".into() },
                Inline::Text { v: "O".into() },
            ],
        }];

        let document = part(
            &build_docx(&blocks, &sample_styles()).expect("docx"),
            "word/document.xml",
        );

        // Word has no such tags, so each becomes the run property that means the
        // same thing on paper.
        assert!(document.contains(r#"<w:u w:val="single"/>"#), "{document}");
        assert!(document.contains(r#"<w:highlight w:val="yellow"/>"#), "{document}");
        assert!(document.contains(r#"<w:vertAlign w:val="subscript"/>"#), "{document}");
        // The contents survive, the tags do not.
        assert!(document.contains("下划线"), "{document}");
        assert!(document.contains("高亮"), "{document}");
        assert!(!document.contains("&lt;u&gt;"), "{document}");
        assert!(!document.contains("&lt;mark&gt;"), "{document}");
    }

    #[test]
    fn the_stored_scale_shrinks_the_printed_picture() {
        let png = PngFile::new("scale");
        let width = |ratio: Option<f32>| {
            let blocks = vec![Block::Image {
                align: "center".into(),
                src: "assets/pic.png".into(),
                file: Some(png.path().to_string()),
                ratio,
                caption: String::new(),
            }];
            let document = part(
                &build_docx(&blocks, &sample_styles()).expect("docx"),
                "word/document.xml",
            );
            // `<wp:extent cx="…" cy="…"/>` is the size Word is given.
            document
                .split("<wp:extent")
                .nth(1)
                .and_then(|rest| rest.split("cx=\"").nth(1))
                .and_then(|rest| rest.split('"').next())
                .and_then(|value| value.parse::<f64>().ok())
                .expect("a width")
        };

        let full = width(None);
        let half = width(Some(0.5));
        assert!(full > 0.0, "the extent went missing");
        assert!(
            (half - full / 2.0).abs() <= 1.0,
            "a half-scale picture should be half as wide: {half} against {full}"
        );
    }

    #[test]
    fn missing_image_degrades_to_text() {
        let blocks = vec![Block::Image {
            align: "center".into(),
            src: "missing.png".into(),
            file: None,
            ratio: None,
            caption: "缺失图片".into(),
        }];
        let bytes = build_docx(&blocks, &sample_styles()).expect("degrade");
        let document = part(&bytes, "word/document.xml");
        assert!(document.contains("缺失图片"));
        assert!(!document.contains("<w:drawing>"));
    }

    #[test]
    fn xml_parts_are_balanced() {
        let bytes = build_docx(&mixed_blocks(None), &sample_styles()).expect("docx");

        let document = part(&bytes, "word/document.xml");
        assert_eq!(document.matches("<w:document").count(), 1);
        assert_balanced(&document, "<w:document", "</w:document>");
        assert_balanced(&document, "<w:body>", "</w:body>");
        assert_balanced(&document, "<w:p>", "</w:p>");
        assert_balanced(&document, "<w:r>", "</w:r>");

        let styles = part(&bytes, "word/styles.xml");
        assert_balanced(&styles, "<w:styles", "</w:styles>");
        assert_balanced(&styles, "<w:style ", "</w:style>");

        let numbering = part(&bytes, "word/numbering.xml");
        assert_balanced(&numbering, "<w:numbering", "</w:numbering>");
        assert_balanced(&numbering, "<w:lvl ", "</w:lvl>");
    }
}
