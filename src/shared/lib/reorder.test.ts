import { describe, expect, it } from "vitest";

import type { RepoState } from "@/ipc/types";
import { makeBranch, makeRepo } from "@/test/factories";

import { flatten } from "./flattenTree";
import { insertionIndexAt, insertionOffset, moveRepo, repoBlocks } from "./reorder";
import { allKeysOf } from "./treeKeys";

/*
 * リポジトリの並び替え。
 *
 * **ドロップ位置は DOM のヒットテストではなく行のインデックスから決める**
 * (docs/adr/0019-reorder-without-dnd-kit.md)。
 * 挿入線はリポジトリのブロック境界に描く。展開中のリポジトリの見出しの下に
 * 線を出すと、配下の行の後ろに着地して線と結果がずれる。
 */

const ROW = 21;

function repos(): RepoState[] {
  return [
    makeRepo("r1", { local: [makeBranch("main"), makeBranch("topic")] }),
    makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
    makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
  ];
}

/** r1 だけ開いた行。r1 は見出し + 括り + 2 ブランチ = 4 行 */
function rowsWithFirstOpen() {
  const all = repos();
  const opened = allKeysOf([all[0]!], ["local"]);
  return flatten(all, {
    expanded: new Set(opened),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

describe("リポジトリのブロック", () => {
  it("見出しから次の見出しの直前までを 1 ブロックにする", () => {
    const blocks = repoBlocks(rowsWithFirstOpen());

    expect(blocks).toEqual([
      { repoId: "r1", start: 0, rows: 4 },
      { repoId: "r2", start: 4, rows: 1 },
      { repoId: "r3", start: 5, rows: 1 },
    ]);
  });

  it("行が無ければブロックも無い", () => {
    expect(repoBlocks([])).toEqual([]);
  });
});

describe("ドロップ位置", () => {
  const blocks = repoBlocks(rowsWithFirstOpen());

  it("ブロックの上半分なら手前に入れる", () => {
    expect(insertionIndexAt(blocks, 0, ROW)).toBe(0);
    expect(insertionIndexAt(blocks, ROW * 4 + 5, ROW)).toBe(1);
  });

  it("ブロックの下半分なら後ろに入れる", () => {
    expect(insertionIndexAt(blocks, ROW * 4 - 1, ROW)).toBe(1);
    expect(insertionIndexAt(blocks, ROW * 5 - 1, ROW)).toBe(2);
  });

  it("展開しているリポジトリは配下の行も同じブロックとして扱う", () => {
    // r1 は 4 行ぶんの高さがある。3 行目 (配下のブランチ) でも境界は
    // ブロックの中央で決まる
    expect(insertionIndexAt(blocks, ROW * 1 + 1, ROW)).toBe(0);
    expect(insertionIndexAt(blocks, ROW * 3 + 1, ROW)).toBe(1);
  });

  it("いちばん下より下なら末尾に入れる", () => {
    expect(insertionIndexAt(blocks, ROW * 99, ROW)).toBe(3);
  });

  it("いちばん上より上なら先頭に入れる", () => {
    expect(insertionIndexAt(blocks, -50, ROW)).toBe(0);
  });

  it("ブロックが無ければ先頭", () => {
    expect(insertionIndexAt([], 100, ROW)).toBe(0);
  });
});

describe("挿入線の位置", () => {
  const blocks = repoBlocks(rowsWithFirstOpen());

  it("ブロックの境界に描く", () => {
    expect(insertionOffset(blocks, 0, ROW)).toBe(0);
    expect(insertionOffset(blocks, 1, ROW)).toBe(ROW * 4);
    expect(insertionOffset(blocks, 2, ROW)).toBe(ROW * 5);
  });

  it("末尾はいちばん下の行の下", () => {
    expect(insertionOffset(blocks, 3, ROW)).toBe(ROW * 6);
  });

  it("ブロックが無ければ 0", () => {
    expect(insertionOffset([], 0, ROW)).toBe(0);
  });
});

describe("並び替え", () => {
  const order = ["r1", "r2", "r3"];

  it("後ろへ動かす", () => {
    expect(moveRepo(order, "r1", 2)).toEqual(["r2", "r1", "r3"]);
    expect(moveRepo(order, "r1", 3)).toEqual(["r2", "r3", "r1"]);
  });

  it("前へ動かす", () => {
    expect(moveRepo(order, "r3", 0)).toEqual(["r3", "r1", "r2"]);
    expect(moveRepo(order, "r3", 1)).toEqual(["r1", "r3", "r2"]);
  });

  it("自分の前後に落としたら変わらない", () => {
    expect(moveRepo(order, "r2", 1)).toEqual(order);
    expect(moveRepo(order, "r2", 2)).toEqual(order);
  });

  it("知らない id は並びを変えない", () => {
    expect(moveRepo(order, "r404", 0)).toEqual(order);
  });
});
