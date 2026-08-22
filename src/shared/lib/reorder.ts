import type { RepoId, RowNode } from "@/ipc/types";

/*
 * リポジトリのドラッグ並び替え。
 *
 * **位置は DOM のヒットテストではなく行のインデックスから決める**
 * (docs/adr/0019-reorder-without-dnd-kit.md)。仮想化すると画面外の行は
 * DOM から消えるので、`elementFromPoint` では離れたリポジトリに落とせない。
 *
 * 挿入位置は「何番目のリポジトリの前か」で持つ。線もその境界に描く。
 * 見出しの下に線を出すと、配下の行の後ろに着地して線と結果がずれる
 * (docs/specs/ui.md の「リポジトリ見出し」)。
 */

/** リポジトリ 1 件ぶんの行の範囲。見出しから次の見出しの直前まで */
export interface RepoBlock {
  readonly repoId: RepoId;
  /** 先頭の行の位置 */
  readonly start: number;
  /** 配下も含めた行数 */
  readonly rows: number;
}

export function repoBlocks(rows: readonly RowNode[]): RepoBlock[] {
  const blocks: RepoBlock[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.kind !== "repo") continue;
    blocks.push({ repoId: row.repoId, start: index, rows: 0 });
  }
  return blocks.map((block, index) => ({
    ...block,
    rows: (blocks[index + 1]?.start ?? rows.length) - block.start,
  }));
}

/**
 * その高さに落としたら何番目に入るか。
 *
 * `y` はリストの先頭からの距離 (スクロール量を足したもの)。
 * **ブロックの中央で前後を分ける。** 展開しているリポジトリは高いので、
 * 見出しの行だけで判定すると配下の行の上に落としたときに戻れなくなる。
 */
export function insertionIndexAt(
  blocks: readonly RepoBlock[],
  y: number,
  rowHeight: number,
): number {
  for (const [index, block] of blocks.entries()) {
    const top = block.start * rowHeight;
    const bottom = top + block.rows * rowHeight;
    if (y >= bottom) continue;
    return y < (top + bottom) / 2 ? index : index + 1;
  }
  return blocks.length;
}

/** 挿入線を描く高さ。ブロックの境界 */
export function insertionOffset(
  blocks: readonly RepoBlock[],
  index: number,
  rowHeight: number,
): number {
  const block = blocks[index];
  if (block !== undefined) return block.start * rowHeight;
  const last = blocks.at(-1);
  return last === undefined ? 0 : (last.start + last.rows) * rowHeight;
}

/**
 * 並びを作り直す。
 *
 * `index` は**動かす前の**並びでの位置。自分を抜いた分だけ後ろにずれる。
 * 折りたたみの鍵はリポジトリ id で作るので、並びを変えても壊れない
 * (docs/specs/data-model.md)。
 */
export function moveRepo(
  order: readonly RepoId[],
  repoId: RepoId,
  index: number,
): readonly RepoId[] {
  const from = order.indexOf(repoId);
  if (from < 0) return order;
  const without = order.filter((id) => id !== repoId);
  const at = index > from ? index - 1 : index;
  return [...without.slice(0, at), repoId, ...without.slice(at)];
}
