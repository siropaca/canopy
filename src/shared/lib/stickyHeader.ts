import type { RepoBlock } from "./reorder";

/*
 * スクロールで隠れたリポジトリ見出しを、ツリーの上端に固定して残す。
 *
 * **CSS の position: sticky では作れない。** 仮想化すると画面外の行は DOM から
 * 消えるので、貼り付ける対象の要素そのものが無くなる
 * (docs/adr/0004-virtual-scroll.md)。固定する見出しは行とは別に描く。
 *
 * ここは位置を決めるだけ。React にも DOM にも依存させない。
 */

/** 上端に固定して描く見出し */
export interface StickyHeader {
  /** 固定する見出しの行のインデックス (ブロックの先頭) */
  readonly rowIndex: number;
  /**
   * 上へずらす量 (px)。0 か負の値。
   *
   * 次のリポジトリの見出しが上端に来ると、固定した見出しはそれに押されて
   * 上へ抜けていく。
   */
  readonly offset: number;
}

/**
 * その位置で固定して出す見出しを返す。`null` なら出さない。
 *
 * `scrollTop` は行を並べている器の先頭からのスクロール量。
 * **見出しの行が上端より上に隠れているときだけ返す。** 行そのものが見えている
 * あいだに出すと、同じ見出しが二重に出る (docs/specs/ui.md の「リポジトリ見出し」)。
 */
export function stickyHeaderAt(
  blocks: readonly RepoBlock[],
  scrollTop: number,
  rowHeight: number,
): StickyHeader | null {
  /** 見出しが上端より上に隠れているブロックのうち、いちばん後ろのもの */
  let hidden: RepoBlock | null = null;

  for (const block of blocks) {
    const top = block.start * rowHeight;
    if (top >= scrollTop) {
      // この見出しはまだ画面に出ている。手前の見出しを押し上げる側になる
      if (hidden === null) return null;
      return { rowIndex: hidden.start, offset: Math.min(0, top - scrollTop - rowHeight) };
    }
    hidden = block;
  }
  // 最後のリポジトリを見ている。押し上げるものが無い
  return hidden === null ? null : { rowIndex: hidden.start, offset: 0 };
}
