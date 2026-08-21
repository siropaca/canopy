/*
 * 相対時刻の文字列。
 *
 * git の `%(committerdate:relative)` は英語の文字列なのでそのまま画面に出せない。
 * 数値 (Unix ミリ秒) で受けて、ここで組み立てる
 * (docs/adr/0013-type-generation.md)。
 */

const formatter = new Intl.RelativeTimeFormat("ja", { numeric: "always" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * `timestamp` を `now` から見た相対時刻にする。
 *
 * 1 分未満は「たった今」。未来 (時計のずれ) は「n 分後」になる。
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (Math.abs(elapsed) < MINUTE) return "たった今";

  const [unit, size] = pickUnit(Math.abs(elapsed));
  // 経過は負の値で渡す (2 日前 = -2 day)
  return formatter.format(-Math.trunc(elapsed / size), unit);
}

function pickUnit(elapsed: number): [Intl.RelativeTimeFormatUnit, number] {
  if (elapsed < HOUR) return ["minute", MINUTE];
  if (elapsed < DAY) return ["hour", HOUR];
  if (elapsed < MONTH) return ["day", DAY];
  if (elapsed < YEAR) return ["month", MONTH];
  return ["year", YEAR];
}
