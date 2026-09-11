//! MathML → OMML.
//!
//! Word stores an equation as OMML (`m:oMath`), not as MathML, and it only
//! converts MathML on paste — a `.docx` has to carry the OMML itself. The
//! frontend already renders every formula to MathML with KaTeX, so this walks
//! that tree and writes the equivalent OMML.
//!
//! The mapping is structural: MathML's layout elements (`mfrac`, `msup`, `mrad`,
//! `mtable`) each have one OMML counterpart, and identifiers, numbers and
//! operators all become runs. Anything unrecognised is unwrapped into its
//! children rather than dropped, so an unusual construct degrades to plain
//! symbols instead of disappearing from the document.

use roxmltree::Node;

/// Word's maths font; without it the engine falls back and spacing drifts.
const MATH_FONT: &str = "Cambria Math";

/// The large operators, which Word sets with their limits above and below rather
/// than to the side.
const NARY_CHARS: [char; 10] = ['∫', '∬', '∭', '∮', '∯', '∑', '∏', '∐', '⋃', '⋂'];

/// Converts a MathML document into the contents of one `<m:oMath>` element.
///
/// `None` when the input is not XML at all, which is how an empty rendering from
/// the frontend arrives.
pub fn to_omml(mathml: &str) -> Option<String> {
    let document = roxmltree::Document::parse(mathml).ok()?;
    let math = document.root_element();
    if math.tag_name().name() != "math" {
        return None;
    }

    let body = sequence(math.children());
    if body.trim().is_empty() {
        return None;
    }
    Some(format!("<m:oMath>{body}</m:oMath>"))
}

/// The OMML for a list of sibling nodes.
///
/// One rule is applied here rather than per node: a large operator takes the run
/// of symbols that follow it as its operand. OMML's n-ary element has a
/// *required* operand, and Word draws an empty one as a dashed placeholder — a
/// stray square in the middle of the formula. Filling it with the integrand is
/// both what the reader expects and what removes the square; an operator with
/// nothing to take falls back to a plain script pair, which has no operand slot.
fn sequence<'a, 'input: 'a>(nodes: impl Iterator<Item = Node<'a, 'input>>) -> String {
    let items: Vec<Node<'a, 'input>> = nodes.filter(Node::is_element).collect();
    let mut out = String::new();
    let mut index = 0;

    while index < items.len() {
        let node = items[index];

        if let Some(character) = nary_character(node) {
            let (sub, sup) = scripts(node);
            let from = index + 1;
            let to = items[from..]
                .iter()
                .position(|candidate| ends_operand(*candidate))
                .map(|offset| from + offset)
                .unwrap_or(items.len());

            if to > from {
                let operand = sequence(items[from..to].iter().copied());
                out.push_str(&format!(
                    "<m:nary><m:naryPr><m:chr m:val=\"{character}\"/><m:limLoc m:val=\"subSup\"/></m:naryPr><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup><m:e>{operand}</m:e></m:nary>"
                ));
                index = to;
                continue;
            }

            out.push_str(&s_sub_sup(&convert(node).unwrap_or_default(), &sub, &sup));
            index += 1;
            continue;
        }

        out.push_str(&convert(node).unwrap_or_default());
        index += 1;
    }

    out
}

fn s_sub_sup(base: &str, sub: &str, sup: &str) -> String {
    format!("<m:sSubSup><m:e>{base}</m:e><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup></m:sSubSup>")
}

/// The OMML for one node, or `None` when it holds nothing to render.
fn convert<'a, 'input: 'a>(node: Node<'a, 'input>) -> Option<String> {
    if !node.is_element() {
        return None;
    }

    let name = node.tag_name().name();
    match name {
        // Leaves: identifiers, numbers, operators and text are all runs.
        "mi" | "mn" | "mo" | "mtext" => Some(run(&text(node))),
        "mspace" => Some(run("\u{2009}")),
        // Wrappers that carry no layout of their own.
        "math" | "mrow" | "mstyle" | "mpadded" | "mphantom" | "semantics" => {
            let inner = sequence(node.children());
            (!inner.is_empty()).then_some(inner)
        }
        // `<semantics>` carries the TeX source alongside the expression; it is
        // metadata, and rendering it would append the whole formula a second time.
        "annotation" | "annotation-xml" => None,
        "mfrac" => {
            let children: Vec<_> = node.children().filter(Node::is_element).collect();
            let numerator = children.first().and_then(|n| convert(*n));
            let denominator = children.get(1).and_then(|n| convert(*n));
            Some(format!(
                "<m:f><m:num>{}</m:num><m:den>{}</m:den></m:f>",
                numerator.unwrap_or_default(),
                denominator.unwrap_or_default()
            ))
        }
        "msup" => Some(pair("m:sSup", "m:sup", node)),
        "msub" => Some(pair("m:sSub", "m:sub", node)),
        "msubsup" => {
            // The n-ary case is handled by `sequence`, which is the only place
            // that can see the operand; reaching here means the operator stands
            // alone, and a script pair is what it becomes.
            let children = elements(node);
            Some(s_sub_sup(
                &children.first().and_then(|n| convert(*n)).unwrap_or_default(),
                &children.get(1).and_then(|n| convert(*n)).unwrap_or_default(),
                &children.get(2).and_then(|n| convert(*n)).unwrap_or_default(),
            ))
        }
        "msqrt" => Some(format!(
            "<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>{}</m:e></m:rad>",
            sequence(node.children())
        )),
        "mroot" => {
            let children = elements(node);
            Some(format!(
                "<m:rad><m:deg>{}</m:deg><m:e>{}</m:e></m:rad>",
                children.get(1).and_then(|n| convert(*n)).unwrap_or_default(),
                children.first().and_then(|n| convert(*n)).unwrap_or_default()
            ))
        }
        // A delimited group; `mfenced` states the characters, while KaTeX more
        // often writes plain parentheses as runs.
        "mfenced" => Some(format!(
            "<m:d><m:dPr><m:begChr m:val=\"{}\"/><m:endChr m:val=\"{}\"/></m:dPr><m:e>{}</m:e></m:d>",
            node.attribute("open").unwrap_or("("),
            node.attribute("close").unwrap_or(")"),
            sequence(node.children())
        )),
        "mover" => Some(pair("m:limUpp", "m:sup", node)),
        "munder" => Some(pair("m:limLow", "m:sub", node)),
        "munderover" => {
            let children = elements(node);
            let base = children.first().and_then(|n| convert(*n)).unwrap_or_default();
            let sub = children.get(1).and_then(|n| convert(*n)).unwrap_or_default();
            let sup = children.get(2).and_then(|n| convert(*n)).unwrap_or_default();
            Some(format!(
                "<m:sSubSup><m:e>{base}</m:e><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup></m:sSubSup>"
            ))
        }
        "mtable" => {
            let rows: String = node
                .children()
                .filter(|child| child.is_element() && child.tag_name().name() == "mtr")
                .map(|row| {
                    let cells: String = row
                        .children()
                        .filter(|cell| cell.is_element())
                        .map(|cell| format!("<m:e>{}</m:e>", sequence(cell.children())))
                        .collect();
                    format!("<m:mr>{cells}</m:mr>")
                })
                .collect();
            (!rows.is_empty()).then(|| format!("<m:m>{rows}</m:m>"))
        }
        // Unknown layout: hand back whatever it contains.
        _ => {
            let inner = sequence(node.children());
            if !inner.is_empty() {
                return Some(inner);
            }
            let text = text(node);
            (!text.trim().is_empty()).then(|| run(&text))
        }
    }
}

/// A two-part construction: base plus one script, in the given OMML wrapper.
fn pair<'a, 'input: 'a>(wrapper: &str, script: &str, node: Node<'a, 'input>) -> String {
    let children = elements(node);
    let base = children.first().and_then(|n| convert(*n)).unwrap_or_default();
    let value = children.get(1).and_then(|n| convert(*n)).unwrap_or_default();
    format!("<{wrapper}><m:e>{base}</m:e><{script}>{value}</{script}></{wrapper}>")
}

fn elements<'a, 'input: 'a>(node: Node<'a, 'input>) -> Vec<Node<'a, 'input>> {
    node.children().filter(Node::is_element).collect()
}

fn text<'a, 'input: 'a>(node: Node<'a, 'input>) -> String {
    node.text().unwrap_or_default().to_string()
}

/// The character of a large operator, when the node is one with its limits.
///
/// KaTeX writes `∫_0^1` as a sub/superscript pair over the sign, so that shape is
/// what has to be recognised.
fn nary_character<'a, 'input: 'a>(node: Node<'a, 'input>) -> Option<char> {
    if !matches!(node.tag_name().name(), "msubsup" | "msub" | "msup") {
        return None;
    }
    let base = node.children().find(Node::is_element)?;
    if base.tag_name().name() != "mo" {
        return None;
    }
    let character = text(base).trim().chars().next()?;
    NARY_CHARS.contains(&character).then_some(character)
}

/// The two scripts of a large-operator node, as `(sub, sup)`.
fn scripts<'a, 'input: 'a>(node: Node<'a, 'input>) -> (String, String) {
    let children = elements(node);
    let at = |index: usize| {
        children
            .get(index)
            .and_then(|child| convert(*child))
            .unwrap_or_default()
    };

    match node.tag_name().name() {
        "msub" => (at(1), String::new()),
        "msup" => (String::new(), at(1)),
        _ => (at(1), at(2)),
    }
}

/// Whether an operator ends the operand of the large operator before it: what
/// follows belongs to the rest of the expression, not inside the sum or integral.
fn ends_operand<'a, 'input: 'a>(node: Node<'a, 'input>) -> bool {
    if node.tag_name().name() != "mo" {
        return false;
    }
    matches!(
        text(node).trim(),
        "=" | "+"
            | "−"
            | "-"
            | "±"
            | "∓"
            | "<"
            | ">"
            | "≤"
            | "≥"
            | "≠"
            | "≈"
            | "≡"
            | "→"
            | "←"
            | "↔"
            | "⇒"
            | "⇔"
            | ","
            | ";"
    )
}

/// One maths run, with the font Word expects inside an equation.
fn run(text: &str) -> String {
    format!(
        r#"<m:r><w:rPr><w:rFonts w:ascii="{MATH_FONT}" w:hAnsi="{MATH_FONT}" w:cs="{MATH_FONT}"/></w:rPr><m:t xml:space="preserve">{}</m:t></m:r>"#,
        super::export::escape(text)
    )
}

#[cfg(test)]
mod tests {
    use super::to_omml;

    fn omml(mathml: &str) -> String {
        to_omml(mathml).expect("converted")
    }

    /// The shape KaTeX produces for an inline formula. The annotation holds the
    /// TeX source, which must never reach the document as text.
    fn mathml(body: &str) -> String {
        format!(
            r#"<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>{body}</mrow><annotation encoding="application/x-tex">TEXSOURCE</annotation></semantics></math>"#
        )
    }

    #[test]
    fn a_row_of_symbols_becomes_runs() {
        let omml = omml(&mathml("<mi>E</mi><mo>=</mo><mi>m</mi>"));

        assert!(omml.starts_with("<m:oMath>"));
        assert!(omml.ends_with("</m:oMath>"));
        assert_eq!(omml.matches("<m:r>").count(), 3);
        assert!(omml.contains("<m:t xml:space=\"preserve\">E</m:t>"));
        assert!(omml.contains(r#"<m:t xml:space="preserve">=</m:t>"#), "{omml}");
        // The annotation is metadata, not part of the formula.
        assert!(!omml.contains("TEXSOURCE"), "{omml}");
    }

    #[test]
    fn a_superscript_uses_the_script_element() {
        let omml = omml(&mathml("<msup><mi>c</mi><mn>2</mn></msup>"));

        assert!(omml.contains("<m:sSup>"), "{omml}");
        assert!(omml.contains("<m:e>"), "{omml}");
        assert!(omml.contains("<m:sup>"), "{omml}");
        assert!(omml.contains(">c<") && omml.contains(">2<"), "{omml}");
    }

    #[test]
    fn a_fraction_gets_a_numerator_and_a_denominator() {
        let omml = omml(&mathml("<mfrac><mn>1</mn><mn>3</mn></mfrac>"));

        assert!(omml.contains("<m:f><m:num>"), "{omml}");
        assert!(omml.contains("<m:den>"), "{omml}");
    }

    #[test]
    fn a_root_hides_its_degree() {
        let omml = omml(&mathml("<msqrt><mi>x</mi></msqrt>"));

        assert!(omml.contains("<m:rad>"), "{omml}");
        assert!(omml.contains(r#"<m:degHide m:val="1"/>"#), "{omml}");
    }

    #[test]
    fn an_integral_with_limits_becomes_an_nary_operator() {
        // The case that would otherwise print the limits to the side of the sign.
        let omml = omml(&mathml(
            "<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi>",
        ));

        assert!(omml.contains("<m:nary>"), "{omml}");
        assert!(omml.contains(r#"<m:chr m:val="∫"/>"#), "{omml}");
        assert!(omml.contains(r#"<m:limLoc m:val="subSup"/>"#), "{omml}");
        assert!(omml.contains("<m:sub>"), "{omml}");
        assert!(omml.contains("<m:sup>"), "{omml}");
        // The operand is the integrand: an empty one is drawn by Word as a dashed
        // placeholder, which reads as a stray square in the middle of the formula.
        let nary = omml.split("<m:nary>").nth(1).expect("an n-ary operator");
        let inside = nary.split("</m:nary>").next().expect("a closed n-ary");
        let operand = inside
            .split_once("<m:e>")
            .expect("an operand")
            .1
            .split("</m:e>")
            .next()
            .unwrap_or_default();
        assert!(!operand.is_empty(), "empty operand: {omml}");
        assert!(operand.contains(">x<"), "wrong operand: {operand}");
    }

    #[test]
    fn a_large_operator_with_nothing_after_it_is_just_a_script_pair() {
        // No operand to fill, so the n-ary form — and its placeholder — is skipped.
        let omml = omml(&mathml("<msubsup><mo>∑</mo><mn>1</mn><mi>n</mi></msubsup>"));

        assert!(!omml.contains("<m:nary>"), "{omml}");
        assert!(omml.contains("<m:sSubSup>"), "{omml}");
        assert!(!omml.contains("<m:e></m:e>"), "{omml}");
    }

    #[test]
    fn a_relation_ends_the_operand() {
        // `∑ i = n/2`: the equals sign and the fraction belong to the equation,
        // not to the sum.
        let omml = omml(&mathml(
            "<msubsup><mo>∑</mo><mn>1</mn><mi>n</mi></msubsup><mi>i</mi><mo>=</mo><mfrac><mi>n</mi><mn>2</mn></mfrac>",
        ));

        let nary = omml.split("<m:nary>").nth(1).expect("an n-ary operator");
        let (inside, after) = nary.split_once("</m:nary>").expect("a closed n-ary");
        assert!(inside.contains(">i<"), "{inside}");
        assert!(!inside.contains("<m:f>"), "the fraction was swallowed: {inside}");
        assert!(after.contains("<m:f>"), "the fraction went missing: {after}");
    }

    #[test]
    fn a_subsup_that_is_not_an_operator_stays_a_subsup() {
        let omml = omml(&mathml("<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>"));
        assert!(omml.contains("<m:sSubSup>"), "{omml}");
        assert!(!omml.contains("<m:nary>"), "{omml}");
    }

    #[test]
    fn brackets_become_a_delimiter() {
        let omml = omml(&mathml("<mfenced><mi>x</mi></mfenced>"));

        assert!(omml.contains("<m:d>"), "{omml}");
        assert!(omml.contains(r#"<m:begChr m:val="("/>"#), "{omml}");
        assert!(omml.contains(r#"<m:endChr m:val=")"/>"#), "{omml}");
    }

    #[test]
    fn a_matrix_becomes_rows_and_cells() {
        let omml = omml(&mathml(
            "<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable>",
        ));

        assert!(omml.contains("<m:m>"), "{omml}");
        assert_eq!(omml.matches("<m:mr>").count(), 2);
        assert_eq!(omml.matches("<m:e>").count(), 4);
    }

    #[test]
    fn markup_is_escaped_before_it_reaches_the_document() {
        let omml = omml(&mathml("<mtext>a &amp; b</mtext>"));
        assert!(omml.contains("a &amp; b"), "{omml}");
        assert!(!omml.contains("&  "), "{omml}");
    }

    #[test]
    fn an_unrecognised_construct_keeps_its_contents() {
        // Better to lose the layout than the symbols.
        let omml = omml(&mathml("<menclose><mi>y</mi></menclose>"));
        assert!(omml.contains(">y<"), "{omml}");
    }

    #[test]
    fn something_that_is_not_mathml_is_refused() {
        assert!(to_omml("").is_none());
        assert!(to_omml("<p>not maths</p>").is_none());
        assert!(to_omml("<math>   </math>").is_none());
    }
}
