import type { RepoId } from "@/ipc/types";
import { moveRepo } from "@/shared/lib/reorder";

import { useRepoStore } from "./useRepoStore";

/*
 * リポジトリの並び替え。
 *
 * 並びは repo ストアが持ち、保存は `store/persist.ts` が拾う
 * (`UiState.repo_order`)。**折りたたみは触らない。** 鍵はリポジトリ id で
 * 作るので、並びを変えても開閉はそのまま残る (docs/specs/data-model.md)。
 */

/** ドラッグの結果を反映する。`index` は動かす前の並びでの挿入位置 */
export function moveRepository(repoId: RepoId, index: number): void {
  const repos = useRepoStore.getState();
  repos.setOrder(moveRepo(repos.order, repoId, index));
}
