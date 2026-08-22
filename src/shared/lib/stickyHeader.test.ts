import { describe, expect, it } from "vitest";

import type { RepoBlock } from "./reorder";
import { stickyHeaderAt } from "./stickyHeader";

/*
 * スクロールで隠れたリポジトリ見出しを、ツリーの上端に固定して残す位置の計算。
 *
 * **CSS の position: sticky は使えない。** 仮想化すると画面外の行は DOM から
 * 消えるので、見出しの行そのものは残せない (docs/adr/0004-virtual-scroll.md)。
 * 固定する見出しは別に描くので、どのブロックをどれだけずらして描くかをここで決める。
 */

const ROW = 21;

/** r1 と r2 を開いた並び。開いたリポジトリは見出し + 括り + ブランチ 2 = 4 行 */
const BLOCKS: readonly RepoBlock[] = [
  { repoId: "r1", start: 0, rows: 4 },
  { repoId: "r2", start: 4, rows: 4 },
  { repoId: "r3", start: 8, rows: 1 },
];

describe("固定するリポジトリ見出し", () => {
  it("先頭を普通に見ているあいだは固定しない。行そのものが見えている", () => {
    expect(stickyHeaderAt(BLOCKS, 0, ROW)).toBeNull();
  });

  it("見出しが 1px でも上端より上に隠れたら固定する", () => {
    expect(stickyHeaderAt(BLOCKS, 1, ROW)).toEqual({ rowIndex: 0, offset: 0 });
  });

  it("配下の行まで進んでも、隠れている見出しを固定し続ける", () => {
    expect(stickyHeaderAt(BLOCKS, 2 * ROW, ROW)).toEqual({ rowIndex: 0, offset: 0 });
  });

  it("次のリポジトリまで進んだら、そのリポジトリの見出しに入れ替える", () => {
    expect(stickyHeaderAt(BLOCKS, 4 * ROW + 1, ROW)).toEqual({ rowIndex: 4, offset: 0 });
  });

  it("次の見出しが行 1 つぶんまで近づくまでは押し上げない", () => {
    // r2 の見出しは 84px。84 - 63 = 21 でちょうど行 1 つぶん
    expect(stickyHeaderAt(BLOCKS, 63, ROW)).toEqual({ rowIndex: 0, offset: 0 });
  });

  it("次の見出しが近づいたぶんだけ押し上げる", () => {
    // 84 - 70 - 21 = -7
    expect(stickyHeaderAt(BLOCKS, 70, ROW)).toEqual({ rowIndex: 0, offset: -7 });
  });

  it("次の見出しが上端に着いたら、固定した見出しは行 1 つぶん抜けきる", () => {
    expect(stickyHeaderAt(BLOCKS, 4 * ROW, ROW)).toEqual({ rowIndex: 0, offset: -21 });
  });

  it("最後のリポジトリには押し上げるものが無い", () => {
    expect(stickyHeaderAt(BLOCKS, 8 * ROW + 10, ROW)).toEqual({ rowIndex: 8, offset: 0 });
  });

  it("押し上げの量は行高で決まる", () => {
    // 行高 40px なら r2 の見出しは 160px。160 - 140 - 40 = -20
    expect(stickyHeaderAt(BLOCKS, 140, 40)).toEqual({ rowIndex: 0, offset: -20 });
  });

  it("リポジトリが 1 つも無ければ固定しない", () => {
    expect(stickyHeaderAt([], 100, ROW)).toBeNull();
  });

  it("リポジトリが 1 つだけでも、隠れていれば固定する", () => {
    expect(stickyHeaderAt([{ repoId: "r1", start: 0, rows: 4 }], 30, ROW)).toEqual({
      rowIndex: 0,
      offset: 0,
    });
  });
});
