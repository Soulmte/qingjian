import { describe, expect, it } from "vitest";

import { APP_COMMANDS, TOOLBAR_COMMANDS, TOOLBAR_LAYOUT, TOOLBAR_SLOTS } from "@/lib/commands";

/**
 * Guards the top bar against a silent omission.
 *
 * The bar renders itself from the registry, so an id that is listed in the
 * layout but not marked `toolbar: true` renders nothing at all — no error, no
 * warning, just a missing button. That is exactly how adding an entry goes
 * wrong, so it is asserted here instead.
 */
describe("toolbar layout", () => {
  it("only lists commands that are actually rendered", () => {
    const rendered = new Set(TOOLBAR_COMMANDS.map((command) => command.id));

    for (const entry of TOOLBAR_LAYOUT) {
      if (entry === null || TOOLBAR_SLOTS.includes(entry)) continue;
      expect(rendered.has(entry), `${entry} is in the layout but not a toolbar command`).toBe(
        true,
      );
    }
  });

  it("resolves every listed id to a command", () => {
    const known = new Set(APP_COMMANDS.map((command) => command.id));

    for (const entry of TOOLBAR_LAYOUT) {
      if (entry === null || TOOLBAR_SLOTS.includes(entry)) continue;
      expect(known.has(entry), `${entry} is not a registered command`).toBe(true);
    }
  });

  it("places the file actions before the view toggles", () => {
    // A regression guard on the order the bar is read in, not just its contents.
    const index = (id: string) => TOOLBAR_LAYOUT.indexOf(id);
    expect(index("note.save")).toBeLessThan(index("note.export"));
    expect(index("note.export")).toBeLessThan(index("note.delete"));
    expect(index("ALIGN")).toBeLessThan(index("TITLE"));
    expect(index("TITLE")).toBeLessThan(index("settings.open"));
  });

  it("gives every button a compact label", () => {
    // The bar draws `short` under the icon. Without one a button falls back to
    // its full title, which is too wide for an eighteen-button strip and pushes
    // the title slot off the bar.
    for (const command of TOOLBAR_COMMANDS) {
      expect(command.short, `${command.id} has no short label`).toBeTruthy();
      expect(command.icon, `${command.id} has no icon`).toBeTruthy();
    }
  });
});
