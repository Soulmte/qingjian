//! Renderer tests, driven by the payload the frontend actually sends.
//!
//! Kept out of `export.rs` because the fixture is a long single line: the JSON
//! is captured verbatim from `parseMarkdown` in `qingjian/src/lib/export/ir.ts`,
//! so a rename on either side of the IPC boundary fails a test here instead of
//! producing an empty document at runtime.

use super::export::{render_html, render_text, Block, ExportStyles, Inline};
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// One part out of a built `.docx`.
fn part(bytes: &[u8], name: &str) -> String {
    let mut archive = ZipArchive::new(Cursor::new(bytes.to_vec())).expect("open zip");
    let mut file = archive
        .by_name(name)
        .unwrap_or_else(|_| panic!("missing {name}"));
    let mut text = String::new();
    file.read_to_string(&mut text).expect("read part");
    text
}

/// A document that uses every block type the parser can emit.
const FIXTURE_BLOCKS: &str = r##"[{"t":"heading","level":1,"align":"left","runs":[{"t":"text","v":"一级标题"}]},{"t":"paragraph","align":"left","runs":[{"t":"text","v":"普通段落，含 "},{"t":"bold","v":"粗体"},{"t":"text","v":"、"},{"t":"italic","v":"斜体"},{"t":"text","v":"、"},{"t":"strike","v":"删除线"},{"t":"text","v":"、"},{"t":"code","v":"代码"},{"t":"text","v":" 与 "},{"t":"link","v":"链接","href":"https://example.test"},{"t":"text","v":"。"}]},{"t":"paragraph","align":"center","runs":[{"t":"text","v":"居中的段落。"}]},{"t":"heading","level":2,"align":"left","runs":[{"t":"text","v":"二级标题"}]},{"t":"code","lang":"rust","text":"fn main() { println!(\"hi\"); }"},{"t":"quote","blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"引用文字"}]}]},{"t":"list","ordered":false,"items":[{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"无序一"}]},{"t":"list","ordered":false,"items":[{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"嵌套"}]}]}]}]},{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"无序二"}]}]}]},{"t":"list","ordered":false,"items":[{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"已完成"}]}],"checked":true},{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"待办"}]}],"checked":false}]},{"t":"list","ordered":true,"items":[{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"有序一"}]}]},{"blocks":[{"t":"paragraph","align":"left","runs":[{"t":"text","v":"有序二"}]}]}]},{"t":"table","aligns":["left","center","right"],"head":[[{"t":"text","v":"左"}],[{"t":"text","v":"中"}],[{"t":"text","v":"右"}]],"rows":[[[{"t":"text","v":"a"}],[{"t":"text","v":"b"}],[{"t":"text","v":"c"}]]]},{"t":"hr"},{"t":"image","align":"center","src":"assets/p.png","caption":"图注文字"},{"t":"image","align":"right","src":"assets/q.png","caption":""},{"t":"paragraph","align":"left","runs":[{"t":"text","v":"断行前"},{"t":"br"},{"t":"text","v":"断行后"}]}]"##;

const FIXTURE_STYLES: &str = r##"{"bodyFont":"","bodyFontSize":12,"bodyLineHeight":1.7,"headingFont":"","headingBold":true,"headingColor":"","headingSizes":[22,18,16,14,13,12],"headingSpaceBefore":14,"headingSpaceAfter":8,"codeFont":"","codeFontSize":10,"codeBackground":"","pageSize":"a4","marginTop":20,"marginBottom":20,"marginLeft":22,"marginRight":22,"tableBorders":true,"tableHeaderFill":"","imageMaxWidth":100,"title":"文档标题"}"##;

fn fixture() -> (Vec<Block>, ExportStyles) {
    let blocks: Vec<Block> = serde_json::from_str(FIXTURE_BLOCKS).expect("blocks fixture");
    let styles: ExportStyles = serde_json::from_str(FIXTURE_STYLES).expect("styles fixture");
    (blocks, styles)
}

/// The shapes a formula arrives in: inline, display, and one the frontend could
/// not parse and therefore sent without a rendering.
///
/// Written by hand rather than captured from `parseMarkdown`, because what this
/// guards is the IPC boundary and the three renderers, not KaTeX's output — that
/// is covered on the frontend side.
const MATH_BLOCKS: &str = r##"[
  {"t":"paragraph","align":"left","runs":[
    {"t":"text","v":"质能方程 "},
    {"t":"math","tex":"E = mc^2","mathml":"<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></semantics></math>"},
    {"t":"text","v":" 很简洁。"}]},
  {"t":"mathBlock","tex":"\\int_0^1 \\frac{x}{2} dx","mathml":"<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mfrac><mi>x</mi><mn>2</mn></mfrac><mi>d</mi><mi>x</mi></mrow></semantics></math>"},
  {"t":"paragraph","align":"left","runs":[{"t":"math","tex":"\\frac{","mathml":""}]}
]"##;

/// The maths fixture with the shared styles.
fn math_fixture() -> (Vec<Block>, ExportStyles) {
    let blocks: Vec<Block> = serde_json::from_str(MATH_BLOCKS).expect("math fixture");
    let styles: ExportStyles = serde_json::from_str(FIXTURE_STYLES).expect("styles fixture");
    (blocks, styles)
}

/// The fixture with one style setting changed, for the cases that assert on it.
fn styled(configure: impl FnOnce(&mut ExportStyles)) -> ExportStyles {
    let (_, mut styles) = fixture();
    configure(&mut styles);
    styles
}

#[test]
fn the_frontends_payload_deserialises() {
    let (blocks, styles) = fixture();

    assert_eq!(blocks.len(), 14);
    assert!(matches!(blocks[0], Block::Heading { level: 1, .. }));
    assert!(matches!(blocks[9], Block::Table { .. }));
    assert_eq!(styles.heading_sizes.len(), 6);
    assert_eq!(styles.title, "文档标题");
    // The code block keeps its escaped quotes through the IPC boundary.
    match &blocks[4] {
        Block::Code { text, lang } => {
            assert_eq!(lang, "rust");
            assert!(text.contains("println!(\"hi\")"), "{text}");
        }
        other => panic!("expected a code block, got {other:?}"),
    }
}

#[test]
fn html_carries_the_style_mapping() {
    let (blocks, styles) = fixture();
    let html = render_html(&blocks, &styles);

    // The heading ladder is the point of the settings, so it has to reach the
    // stylesheet one level at a time.
    assert!(html.contains("h1 { font-size: 22pt;"), "{html}");
    assert!(html.contains("h6 { font-size: 12pt;"), "{html}");
    assert!(html.contains("font-size: 12pt"), "body size missing");
    assert!(html.contains("size: 210mm 297mm"), "page size missing");
    // The inset is carried by the body: the silent PDF path ignores a CSS page
    // margin and would otherwise lose it.
    assert!(html.contains("padding: 20mm 22mm 20mm 22mm"), "margins missing");
    assert!(html.contains("margin: 0; }"), "page margin should be zeroed");
    // The print path relies on these rules for sensible pagination.
    assert!(html.contains("break-inside: avoid"), "pagination rules missing");
    assert!(html.contains("counters(qj-item"), "multi-level numbering missing");
}

#[test]
fn html_follows_the_alignment_the_editor_stored() {
    let (blocks, styles) = fixture();
    let html = render_html(&blocks, &styles);

    assert!(html.contains("<p class=\"align-center\">"), "{html}");
    assert!(html.contains("<figure class=\"align-right\">"), "{html}");
    assert!(html.contains("图注文字"), "caption missing");
    // A text-align marker must never reach the output as literal text.
    assert!(!html.contains("qj-align"));
}

#[test]
fn html_uses_configured_colours_and_escapes_text() {
    let (mut blocks, _) = fixture();
    blocks.push(Block::Paragraph {
        align: "left".into(),
        runs: vec![Inline::Text {
            v: "<script>alert(1)</script>".into(),
        }],
    });

    let html = render_html(
        &blocks,
        &styled(|styles| {
            styles.heading_color = "#112233".into();
            styles.code_background = "#eeeeee".into();
        }),
    );

    assert!(html.contains("color: #112233"), "heading colour ignored");
    assert!(html.contains("background: #eeeeee"), "code background ignored");
    assert!(html.contains("&lt;script&gt;"), "text was not escaped");
    assert!(!html.contains("<script>alert"), "raw html survived");
}

#[test]
fn html_drops_a_malformed_colour_rather_than_writing_it() {
    let (blocks, _) = fixture();
    let html = render_html(
        &blocks,
        &styled(|styles| styles.heading_color = "not-a-colour".into()),
    );

    assert!(html.contains("color: #1a1a1a"), "fallback colour missing");
}

#[test]
fn a_zero_heading_size_falls_back_instead_of_vanishing() {
    let (blocks, _) = fixture();
    let html = render_html(&blocks, &styled(|styles| styles.heading_sizes = vec![0.0; 6]));

    // Body 12pt + 4, rather than a heading nothing can read.
    assert!(html.contains("h1 { font-size: 16pt;"), "{html}");
}

#[test]
fn html_omits_the_title_when_asked_to() {
    let (blocks, _) = fixture();
    let html = render_html(&blocks, &styled(|styles| styles.title = String::new()));

    assert!(!html.contains("doc-title"), "{html}");
}

#[test]
fn text_renderer_flattens_the_document() {
    let (blocks, styles) = fixture();
    let text = render_text(&blocks, &styles);

    assert!(text.starts_with("文档标题\n\n"));
    assert!(text.contains("# 一级标题"));
    assert!(text.contains("## 二级标题"));
    assert!(text.contains("• 无序一"));
    assert!(text.contains("1. 有序一"));
    assert!(text.contains("☑ 已完成"));
    assert!(text.contains("☐ 待办"));
    assert!(text.contains("左 | 中 | 右"));
    assert!(text.contains("a | b | c"));
    assert!(text.contains("[图片：图注文字]"));
    assert!(!text.contains("qj-align"));
}

#[test]
fn a_line_break_never_survives_as_literal_text() {
    // The editor stores an empty paragraph as `<br />`, so it must arrive at the
    // exports as a break, not as four characters the reader has to look at.
    let (blocks, styles) = fixture();
    let html = render_html(&blocks, &styles);
    let text = render_text(&blocks, &styles);

    assert!(html.contains("断行前<br />断行后"), "{html}");
    assert!(!html.contains("&lt;br"), "raw break leaked into html");
    assert!(
        text.contains("断行前\n断行后"),
        "plain text lost the break: {text}"
    );
    assert!(!text.contains("<br"), "raw break leaked into text");
}

#[test]
fn list_items_keep_their_text_inline_and_their_nesting() {
    let (blocks, styles) = fixture();
    let html = render_html(&blocks, &styles);

    // The marker shares a line box with the item's first line, and the nested
    // list stays inside the item rather than beside it.
    assert!(html.contains("<li>无序一<ul>"), "{html}");
    assert!(html.contains("<li>嵌套</li>"), "{html}");
    assert!(html.contains("<li>有序一</li>"), "{html}");
    // No item's opening line may be wrapped in a paragraph.
    assert!(!html.contains("<li><p>"), "{html}");
}

#[test]
fn task_items_carry_their_checkbox_into_the_html() {
    let (blocks, styles) = fixture();
    let html = render_html(&blocks, &styles);

    assert!(html.contains("<li class=\"task-item\">"), "{html}");
    assert!(html.contains("☑"), "checked box missing");
    assert!(html.contains("☐"), "unchecked box missing");
}

#[test]
fn formulas_reach_the_html_as_mathml() {
    let (blocks, styles) = math_fixture();
    let html = render_html(&blocks, &styles);

    assert!(html.contains("<span class=\"qj-math\">"), "{html}");
    assert!(html.contains("<div class=\"qj-math-block\">"), "{html}");
    assert!(html.contains("<msup>"), "the inline rendering is missing");
    assert!(html.contains("<mfrac>"), "the display rendering is missing");
    // The rendering replaces the source; it must not also be shown.
    assert!(!html.contains("$E = mc^2$"), "{html}");
    // An unparsable formula falls back to its source rather than vanishing.
    assert!(html.contains("<code>\\frac{</code>"), "{html}");
}

#[test]
fn formulas_reach_the_text_export_as_their_source() {
    let (blocks, styles) = math_fixture();
    let text = render_text(&blocks, &styles);

    assert!(text.contains("$E = mc^2$"), "{text}");
    assert!(text.contains("$$\\int_0^1 \\frac{x}{2} dx$$"), "{text}");
}

#[test]
fn formulas_reach_word_as_omml() {
    let (blocks, styles) = math_fixture();
    let bytes = super::docx::build_docx(&blocks, &styles).expect("docx");
    let document = part(&bytes, "word/document.xml");

    // Word has no MathML, so the equation has to arrive converted — and the
    // prefix has to be declared for the part to load at all.
    assert!(document.contains("xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\""), "{document}");
    assert!(document.contains("<m:oMath>"), "no equation in the document");
    assert!(document.contains("<m:sSup>"), "superscript missing");
    assert!(document.contains("<m:nary>"), "integral missing");
    assert!(document.contains("<m:f>"), "fraction missing");
    // The MathML itself must never reach the document.
    assert!(!document.contains("<math"), "{document}");
    // And the source that could not be read stays visible as text.
    assert!(document.contains("$\\frac{$"), "{document}");
}

#[test]
fn inline_markup_survives_into_the_html() {
    let (_, styles) = fixture();
    let blocks = vec![Block::Paragraph {
        align: "left".into(),
        runs: vec![
            Inline::Text { v: "按 ".into() },
            Inline::Html { v: "<kbd>".into() },
            Inline::Text { v: "Ctrl".into() },
            Inline::Html { v: "</kbd>".into() },
            Inline::Text { v: " 保存，H".into() },
            Inline::Html { v: "<sub>".into() },
            Inline::Text { v: "2".into() },
            Inline::Html { v: "</sub>".into() },
            Inline::Text { v: "O".into() },
        ],
    }];

    let html = render_html(&blocks, &styles);
    // Raw inline HTML is markup, not four visible characters.
    assert!(html.contains("<kbd>Ctrl</kbd>"), "{html}");
    assert!(html.contains("H<sub>2</sub>O"), "{html}");
    assert!(!html.contains("&lt;kbd&gt;"), "the tag was escaped: {html}");

    // The text export has no markup to keep, so only the words remain.
    let text = render_text(&blocks, &styles);
    assert!(text.contains("按 Ctrl 保存，H2O"), "{text}");
    assert!(!text.contains("<kbd>"), "{text}");
}

#[test]
fn the_stored_image_scale_reaches_the_page() {
    let (_, styles) = fixture();
    let blocks = vec![Block::Image {
        align: "center".into(),
        src: "assets/p.png".into(),
        file: None,
        ratio: Some(0.44),
        caption: "图".into(),
    }];

    let html = render_html(&blocks, &styles);
    assert!(html.contains(r#"style="max-width: 44.0%""#), "{html}");

    // The user's global maximum still wins when it is the smaller of the two.
    let capped = render_html(
        &blocks,
        &styled(|styles| styles.image_max_width = 30.0),
    );
    assert!(capped.contains(r#"style="max-width: 30.0%""#), "{capped}");

    // An image nobody resized keeps the stylesheet's own limit.
    let natural = render_html(
        &vec![Block::Image {
            align: "center".into(),
            src: "assets/p.png".into(),
            file: None,
            ratio: None,
            caption: String::new(),
        }],
        &styles,
    );
    assert!(!natural.contains("style=\"max-width"), "{natural}");
}

#[test]
fn the_word_renderer_accepts_the_same_payload() {
    // The end-to-end check the frontend cannot make: the payload has to survive
    // the Word writer too, not just the HTML one.
    let (blocks, styles) = fixture();
    let bytes = super::docx::build_docx(&blocks, &styles).expect("docx from fixture");

    assert_eq!(&bytes[..4], b"PK\x03\x04");
}

#[test]
#[ignore = "prints a document for eyeballing; run with --ignored --nocapture"]
fn dump_for_inspection() {
    let (blocks, styles) = fixture();
    print!("{}", render_html(&blocks, &styles));
}
