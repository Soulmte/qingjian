import katex from "katex";

/**
 * LaTeX → MathML, for the exporters.
 *
 * MathML rather than KaTeX's usual HTML: that output needs KaTeX's stylesheet and
 * a fistful of web fonts to look like anything, and an exported document has to
 * stand on its own. MathML is drawn by the reader's own engine — the browser for
 * the HTML and PDF exports, and Word after the conversion in `commands/omml.rs` —
 * so the exported file carries no assets.
 *
 * The editor already renders formulas with KaTeX, so this adds no dependency.
 */
export function toMathML(tex: string, display: boolean): string {
  try {
    const html = katex.renderToString(tex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
    });

    // KaTeX wraps the result in `<span class="katex">`, which means nothing
    // without its stylesheet. Only the `<math>` element is wanted.
    const start = html.indexOf("<math");
    const end = html.lastIndexOf("</math>");
    if (start === -1 || end === -1) return "";
    return html.slice(start, end + "</math>".length);
  } catch {
    // An expression KaTeX refuses outright; the renderers fall back to the
    // source so the formula is never silently dropped.
    return "";
  }
}
