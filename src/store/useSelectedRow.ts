import { useMemo } from "react";

import type { RowNode } from "@/ipc/types";

import { useUiStore } from "./useUiStore";

/**
 * 「**画面に見えている**選択」を解く。
 *
 * 折りたたみや検索で選択行が消えたら `null` になる。詳細ペインの内容も
 * サイドバーとメニューの有効条件も、これを基準にする
 * (docs/specs/ui.md の「詳細ペイン」)。
 *
 * 選択そのものは `useUiStore` が保持したままなので、開き直すと戻る。
 *
 * **行の配列は引数で受ける。** ここで `useTreeRows()` を呼ぶと、
 * ツリーと詳細ペインで平坦化が 2 回走る (docs/architecture.md)。
 */
export function useSelectedRow(rows: readonly RowNode[]): RowNode | null {
  const selectedKey = useUiStore((state) => state.selectedKey);

  return useMemo(() => rows.find((row) => row.key === selectedKey) ?? null, [rows, selectedKey]);
}
