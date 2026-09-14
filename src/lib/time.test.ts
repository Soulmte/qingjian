import { describe, expect, it } from "vitest";

import { formatRevisionTime } from "@/lib/time";

/** Local noon on 2026-09-14, so the assertions do not depend on the clock. */
const NOW = new Date(2026, 8, 14, 12, 0, 0);

const secondsOf = (date: Date) => Math.floor(date.getTime() / 1000);

describe("formatRevisionTime", () => {
  it("shows only the clock for something saved today", () => {
    const at = new Date(2026, 8, 14, 9, 5, 0);
    expect(formatRevisionTime(secondsOf(at), NOW)).toBe("09:05");
  });

  it("adds the date for something saved earlier this year", () => {
    const at = new Date(2026, 2, 5, 14, 3, 0);
    expect(formatRevisionTime(secondsOf(at), NOW)).toBe("3月5日 14:03");
  });

  it("adds the year for anything older", () => {
    const at = new Date(2025, 2, 5, 14, 3, 0);
    expect(formatRevisionTime(secondsOf(at), NOW)).toBe("2025年3月5日");
  });

  it("treats yesterday as earlier this year, not as today", () => {
    const at = new Date(2026, 8, 13, 23, 30, 0);
    expect(formatRevisionTime(secondsOf(at), NOW)).toBe("9月13日 23:30");
  });

  it("gives nothing for a value that is not a time", () => {
    expect(formatRevisionTime(0, NOW)).toBe("");
    expect(formatRevisionTime(-1, NOW)).toBe("");
    expect(formatRevisionTime(Number.NaN, NOW)).toBe("");
  });
});
