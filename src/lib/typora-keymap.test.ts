/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Guards the one trap in `typora-keymap.ts`.
 *
 * Milkdown's `$command` attaches `.key` inside the command's own async plugin,
 * so at module scope a command's key is still `undefined`. Reading it there made
 * every chord in this file dispatch `commands.call(undefined, …)`, which threw
 * inside the keydown handler where nothing could surface it: pressing Ctrl+1 did
 * nothing at all, and the shortcuts page went on advertising twenty-one chords
 * that were dead.
 *
 * A behavioural test would need a mounted Milkdown editor. This source check is
 * cheap and catches exactly the mistake, because there is no correct way to read
 * a command's key at module scope — the object is what gets passed around.
 */
const source = readFileSync(new URL("./typora-keymap.ts", import.meta.url), "utf8");
/** Comments explain the trap, so they must not count as the trap. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("typora keymap", () => {
  it("passes command objects rather than reading their keys at import time", () => {
    expect(code).not.toMatch(/[A-Za-z]+Command\.key/);
  });

  it("still binds the chords the shortcuts page advertises", () => {
    // The page claims Ctrl+1…6 and Ctrl+0 for headings and paragraphs; those are
    // exactly the entries that were dead, so their absence would be a regression
    // the page could not show.
    for (const chord of ["Mod-1", "Mod-2", "Mod-3", "Mod-4", "Mod-5", "Mod-6", "Mod-0"]) {
      expect(source).toContain(`shortcuts: "${chord}"`);
    }
  });

  it("leaves the alignment chords to the app-level commands", () => {
    // Ctrl+Shift+E/R used to be claimed twice: this keymap ran the GFM preset's
    // table-column command, and `format.alignCenter/Right` aligned the block. The
    // app commands now own the chord and hand a table over to the preset
    // themselves, so binding it here again would reintroduce the ambiguity.
    expect(source).not.toContain("Mod-Shift-e");
    expect(source).not.toContain("Mod-Shift-r");
    expect(source).not.toContain("setAlignCommand");
  });
});
