import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relativeTime";

/** 2026-08-21 12:00:00 JST */
const NOW = 1_787_000_000_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("1 分未満は「たった今」", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("たった今");
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe("たった今");
  });

  it("分・時間・日で単位を切り替える", () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW)).toBe("5 分前");
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW)).toBe("3 時間前");
    expect(formatRelativeTime(NOW - 2 * DAY, NOW)).toBe("2 日前");
  });

  it("30 時間前は「1 日前」", () => {
    expect(formatRelativeTime(NOW - 30 * HOUR, NOW)).toBe("1 日前");
  });

  it("月と年に丸める", () => {
    expect(formatRelativeTime(NOW - 45 * DAY, NOW)).toBe("1 か月前");
    expect(formatRelativeTime(NOW - 400 * DAY, NOW)).toBe("1 年前");
  });

  it("端数は切り捨てる。3 週間は「21 日前」", () => {
    expect(formatRelativeTime(NOW - 21 * DAY - HOUR, NOW)).toBe("21 日前");
  });

  it("時計がずれて未来になっていても壊れない", () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("5 分後");
  });
});
