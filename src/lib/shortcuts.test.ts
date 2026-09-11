import { describe, expect, it } from "vitest";

import { APP_COMMANDS, type Accel } from "@/lib/commands";
import { SHORTCUT_GROUPS, boundBindings, isActive } from "@/lib/shortcuts";

/**
 * Guards the contract between what the app binds and what the shortcuts page
 * claims.
 *
 * The page used to carry its own hand-written status flags, so a binding could
 * be documented as working while nothing listened for it. These tests fail as
 * soon as the two drift apart.
 */

const ENTRIES = SHORTCUT_GROUPS.flatMap((group) => group.entries);

/** Canonical form of an accelerator, used to detect two commands on one chord. */
function chordOf(accel: Accel): string {
  return [
    accel.mod ? "mod" : "",
    accel.alt ? "alt" : "",
    accel.shift ? "shift" : "",
    accel.code ? `code:${accel.code}` : `key:${accel.key}`,
  ]
    .filter(Boolean)
    .join("+");
}

/** The label a `code`-based accelerator should be shown with. */
const CODE_LABELS: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Digit0: "0",
  Digit1: "1",
};

/** Rebuilds the display string from the accelerator it is supposed to describe. */
function displayOf(accel: Accel): string {
  const parts: string[] = [];
  if (accel.mod) parts.push("Ctrl");
  if (accel.alt) parts.push("Alt");
  if (accel.shift) parts.push("Shift");
  parts.push(accel.code ? (CODE_LABELS[accel.code] ?? accel.code) : accel.key!.toUpperCase());
  return parts.join("+");
}

describe("command registry", () => {
  it("has unique ids", () => {
    const ids = APP_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never binds one chord to two commands", () => {
    const seen = new Map<string, string>();
    for (const command of APP_COMMANDS) {
      if (!command.accel) continue;
      const chord = chordOf(command.accel);
      const previous = seen.get(chord);
      expect(previous, `${chord} 被 ${previous} 和 ${command.id} 同时占用`).toBeUndefined();
      seen.set(chord, command.id);
    }
  });

  it("gives every bound command a display string", () => {
    for (const command of APP_COMMANDS) {
      if (command.accel) {
        expect(command.shortcut, `${command.id} 有键位但没有可显示的快捷键`).toBeTruthy();
      }
    }
  });

  it("shows the chord it actually listens for", () => {
    // A mismatch here is the classic copy-paste bug: the tooltip advertises
    // Ctrl+Shift+S while the handler waits for Ctrl+S.
    for (const command of APP_COMMANDS) {
      if (!command.accel || !command.shortcut) continue;
      expect(displayOf(command.accel), `${command.id} 的显示文案与绑定不一致`).toBe(
        command.shortcut,
      );
    }
  });

  it("uses one binding style: letters via `key`, punctuation via `code`", () => {
    for (const command of APP_COMMANDS) {
      const accel = command.accel;
      if (!accel) continue;
      expect(Boolean(accel.key) !== Boolean(accel.code), `${command.id} 必须恰好指定 key 或 code 之一`).toBe(
        true,
      );
      if (accel.key) {
        expect(accel.key, `${command.id} 的 key 必须是小写`).toBe(accel.key.toLowerCase());
      }
    }
  });
});

describe("shortcuts page", () => {
  it("documents every shortcut the registry binds", () => {
    const documented = new Set(ENTRIES.flatMap((entry) => entry.chords));
    for (const command of APP_COMMANDS) {
      if (!command.shortcut) continue;
      expect(documented, `${command.id}（${command.shortcut}）没有出现在快捷键页`).toContain(
        command.shortcut,
      );
    }
  });

  it("only marks an entry as implemented when something actually binds it", () => {
    const bound = boundBindings();
    for (const entry of ENTRIES) {
      if (!isActive(entry, bound)) continue;
      for (const chord of entry.chords) {
        expect(bound.has(chord), `${entry.description} 标为可用但 ${chord} 没有绑定`).toBe(true);
      }
    }
  });

  it("keeps every unimplemented entry annotated with a reason", () => {
    const bound = boundBindings();
    for (const entry of ENTRIES) {
      if (isActive(entry, bound)) continue;
      expect(entry.note, `${entry.description} 标为待实现，但没有说明原因`).toBeTruthy();
    }
  });

  it("gives every entry at least one chord", () => {
    for (const entry of ENTRIES) {
      expect(entry.chords.length, `${entry.description} 没有键位`).toBeGreaterThan(0);
    }
  });

  it("does not list a duplicate description", () => {
    const descriptions = ENTRIES.map((entry) => entry.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
