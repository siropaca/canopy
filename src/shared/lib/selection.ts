import type { RowNode } from "@/ipc/types";

/*
 * 行に対する述語。
 *
 * 「有効になる条件」は docs/specs/ui.md の表。判定は React に依存しない形でここに置く。
 * フェーズ 2 でコンテキストメニューと詳細ペインが同じ判定を要るので、
 * features のコンポーネントには置かない (features 同士は参照できない)。
 *
 * 有効条件は「選択の種類」ではなく「**画面に見えている**選択の種類」なので、
 * 渡すのは平坦化した行 (見えていない選択は null になる)。
 */

/** 折りたためる行か。ダブルクリックの振る舞いが分かれる */
export function isFoldable(row: RowNode): boolean {
  return row.kind === "repo" || row.kind === "section" || row.kind === "directory";
}

/**
 * 「選択対象をプル」を有効にできるか。
 *
 * - リポジトリ: 現在ブランチが要る。**detached HEAD では無効** (docs/specs/ui.md)
 * - ローカルブランチ: 追跡先が消えていると必ず `couldn't find remote ref` で
 *   失敗するので無効 (docs/specs/ui.md の「ブランチ行」)
 * - それ以外 (括り・ディレクトリ・リモート・タグ): 無効
 */
export function canPullSelection(row: RowNode | null): boolean {
  if (row === null) return false;
  if (row.kind === "repo") return row.repo.snapshot?.head.kind === "branch";
  if (row.kind === "branch") return !row.branch.upstream_gone;
  return false;
}
