import { describe, expect, it, vi } from "vitest";

import { printHtml } from "@/lib/print";

/**
 * A `document` double: just the members `printHtml` touches, with the load event
 * left for the test to fire so the ordering can be asserted.
 */
function fakeDocument() {
  const print = vi.fn();
  const focus = vi.fn();
  const remove = vi.fn();
  const listeners: Record<string, () => void> = {};
  const timeouts: (() => void)[] = [];

  const frame = {
    style: { cssText: "" },
    srcdoc: "",
    contentWindow: { focus, print },
    setAttribute: vi.fn(),
    addEventListener: (type: string, handler: () => void) => {
      listeners[type] = handler;
    },
    remove,
  };

  const doc = {
    createElement: vi.fn(() => frame),
    body: { appendChild: vi.fn() },
    defaultView: {
      setTimeout: (handler: () => void) => {
        timeouts.push(handler);
        return 0;
      },
    },
  };

  return { doc, frame, listeners, print, focus, remove, timeouts };
}

describe("printHtml", () => {
  it("mounts an off-screen frame holding the document", async () => {
    const env = fakeDocument();
    const pending = printHtml("<p>hi</p>", { doc: env.doc as unknown as Document });

    expect(env.frame.srcdoc).toBe("<p>hi</p>");
    expect(env.doc.body.appendChild).toHaveBeenCalledWith(env.frame);
    expect(env.frame.style.cssText).toContain("position:fixed");
    expect(env.frame.style.cssText).toContain("width:210mm");

    env.listeners.load();
    await pending;
  });

  it("waits for the load event before printing", async () => {
    const env = fakeDocument();
    const pending = printHtml("<p>hi</p>", { doc: env.doc as unknown as Document });

    expect(env.print).not.toHaveBeenCalled();

    env.listeners.load();
    await pending;

    expect(env.focus).toHaveBeenCalled();
    expect(env.print).toHaveBeenCalledTimes(1);
    // The frame must outlive the call: the browser is still holding the job.
    expect(env.remove).not.toHaveBeenCalled();

    env.timeouts.forEach((run) => run());
    expect(env.remove).toHaveBeenCalledTimes(1);
  });

  it("honours a custom page box", async () => {
    const env = fakeDocument();
    const pending = printHtml("<p>hi</p>", {
      doc: env.doc as unknown as Document,
      page: { width: "8.5in", height: "11in" },
    });

    expect(env.frame.style.cssText).toContain("width:8.5in");
    expect(env.frame.style.cssText).toContain("height:11in");

    env.listeners.load();
    await pending;
  });
});
