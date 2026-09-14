import { describe, expect, it } from "vitest";

import { formatBytes, formatRemaining, formatSpeed } from "@/lib/update";

describe("formatBytes", () => {
  it("scales to the unit that reads best", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  });
});

describe("formatSpeed", () => {
  it("reads as a rate", () => {
    expect(formatSpeed(1536)).toBe("2 KB/s");
    expect(formatSpeed(2 * 1048576)).toBe("2.0 MB/s");
  });
});

describe("formatRemaining", () => {
  it("counts down in seconds, then minutes", () => {
    // 10 MB left at 1 MB/s.
    expect(formatRemaining(10 * 1048576, 1048576)).toBe("约剩 10 秒");
    // 50 MB left at 500 KB/s: 100 seconds, which reads better as minutes.
    expect(formatRemaining(50 * 1048576, 500 * 1024)).toBe("约剩 2 分钟");
    // 3 MB left at 100 KB/s is 31 seconds — still seconds.
    expect(formatRemaining(3 * 1048576, 100 * 1024)).toBe("约剩 31 秒");
  });

  it("says nothing when the answer would be noise", () => {
    // Under a second: the last few bytes would make the reading jump.
    expect(formatRemaining(1024, 1048576)).toBeNull();
    // No speed yet, nothing left, or a stalled connection.
    expect(formatRemaining(1048576, 0)).toBeNull();
    expect(formatRemaining(0, 1048576)).toBeNull();
    expect(formatRemaining(-5, 1048576)).toBeNull();
  });
});
