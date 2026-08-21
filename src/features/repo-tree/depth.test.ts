import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_DEPTH } from "@/shared/lib/flattenTree";

/*
 * インデントの段数を CSS と突き合わせる。
 *
 * `flatten` は `MAX_DEPTH` で深さを丸めるが、実際のインデントは CSS の
 * `[data-depth="N"]` が出す。片方だけ動かすと、深い行がインデント無しで並ぶ。
 */

const CSS = fileURLToPath(new URL("./TreeRow.module.css", import.meta.url));

/** CSS が持っている `[data-depth="N"]` の N を読む */
export function readDepths(css: string): number[] {
  return [...css.matchAll(/\[data-depth="(\d+)"\]/g)]
    .map(([, depth]) => Number(depth))
    .sort((left, right) => left - right);
}

describe("インデントの段数", () => {
  const depths = readDepths(readFileSync(CSS, "utf8"));

  it("0 から MAX_DEPTH まで抜けなく並んでいる", () => {
    expect(depths).toEqual(Array.from({ length: MAX_DEPTH + 1 }, (_, index) => index));
  });
});

describe("readDepths", () => {
  it("段数を数値で読む", () => {
    expect(readDepths('.row[data-depth="0"]{}.row[data-depth="2"]{}')).toEqual([0, 2]);
  });
});
