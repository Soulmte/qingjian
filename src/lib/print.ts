/**
 * Printing a rendered document through the webview's own print pipeline.
 *
 * The page is loaded into an off-screen iframe rather than printed from the main
 * window, so the editor's chrome — sidebar, toolbar, floating menus — is not part
 * of the printout. `srcdoc` is used instead of a `file://` URL because the frame
 * then shares the page's origin and is still allowed to open the print dialog.
 *
 * Printing is also how PDF is produced: the dialog offers "Microsoft Print to
 * PDF" (or any other installed PDF driver), which is the only way to get a PDF
 * with correct Chinese text without shipping a font-embedding renderer.
 */

/** The off-screen box the frame is laid out in; the printed page comes from `@page`. */
const DEFAULT_PAGE = { width: "210mm", height: "297mm" };

export interface PrintOptions {
  /** Injected for tests; the real call uses the ambient document. */
  doc?: Document;
  page?: { width: string; height: string };
}

export async function printHtml(html: string, options: PrintOptions = {}): Promise<void> {
  const doc = options.doc ?? document;
  const page = options.page ?? DEFAULT_PAGE;

  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${page.width}`,
    `height:${page.height}`,
    "border:0",
  ].join(";");

  // Attached before the content is set, so a synchronous load cannot be missed.
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });

  frame.srcdoc = html;
  doc.body.appendChild(frame);
  // `load` fires once every subresource has arrived, which matters because the
  // pictures are inline data URLs the printer would otherwise render as blanks.
  await loaded;

  frame.contentWindow?.focus();
  frame.contentWindow?.print();

  // Chromium hands the job to the dialog asynchronously; removing the frame
  // immediately would cancel the printout, so it is torn down a moment later.
  const view = doc.defaultView;
  if (view) view.setTimeout(() => frame.remove(), 1000);
  else frame.remove();
}
