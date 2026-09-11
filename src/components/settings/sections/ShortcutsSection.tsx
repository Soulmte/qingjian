import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { isActive, SHORTCUT_GROUPS, shortcutSummary } from "@/lib/shortcuts";

/** Word used between alternative bindings. */
const ALTERNATIVE = "或";

/** Renders an entry's chords as key caps, splitting each on `+`. */
function Keys({ chords }: { chords: string[] }) {
  const parts: ReactNode[] = [];

  chords.forEach((chord, chordIndex) => {
    if (chordIndex > 0) {
      parts.push(
        <span key={`alt-${chord}`} className="px-0.5 text-[11px] text-muted">
          {ALTERNATIVE}
        </span>,
      );
    }

    chord.split("+").forEach((key, index) => {
      if (index > 0) {
        parts.push(
          <span key={`plus-${chord}-${index}`} className="text-[10px] text-muted">
            +
          </span>,
        );
      }
      parts.push(
        <kbd
          key={`key-${chord}-${index}`}
          className="rounded-md border border-border/70 bg-default/50 px-1.5 py-0.5 font-mono text-[11px] text-muted"
        >
          {key}
        </kbd>,
      );
    });
  });

  return <span className="flex shrink-0 items-center gap-1">{parts}</span>;
}

export function ShortcutsSection() {
  const { active, planned } = shortcutSummary();

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {`已支持 ${active} 项，待实现 ${planned} 项。`}
        {planned > 0 &&
          "标为「待实现」的条目要么功能尚未落地，要么键位与其它命令冲突，备注里写明了原因。"}
      </p>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="mb-5">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            {group.title}
          </h3>

          <div className="overflow-hidden rounded-xl border border-border/70 bg-surface">
            {group.entries.map((entry) => {
              const supported = isActive(entry);
              return (
                <div
                  key={`${entry.description}-${entry.chords.join("-")}`}
                  className="flex items-start justify-between gap-4 border-b border-border/50 px-3.5 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className={cn("text-sm", !supported && "text-muted")}>
                      {entry.description}
                    </p>
                    {entry.note && <p className="mt-0.5 text-xs text-muted">{entry.note}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!supported && (
                      <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted">
                        待实现
                      </span>
                    )}
                    <Keys chords={entry.chords} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
