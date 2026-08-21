import { allKeysOf } from "@/shared/lib/treeKeys";

import { orderedRepos, useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

/*
 * ツリーの展開・折りたたみ。
 *
 * リポジトリの中身 (repo ストア) と開いている鍵 (UI ストア) の両方を触るので、
 * どちらか片方のストアには置けない。登録・削除と同じ層に置く
 * (docs/architecture.md の状態管理)。
 */

/** すべて展開。リモートとタグの中まで開く */
export function expandAll(): void {
  const repos = orderedRepos(useRepoStore.getState());
  useUiStore.getState().setExpanded(allKeysOf(repos, ["local", "remote", "tag"]));
}

/** すべて展開 (ローカルのみ)。リモートとタグは閉じたまま */
export function expandLocalOnly(): void {
  const repos = orderedRepos(useRepoStore.getState());
  useUiStore.getState().setExpanded(allKeysOf(repos, ["local"]));
}

/** すべて折りたたむ */
export function collapseAll(): void {
  useUiStore.getState().setExpanded([]);
}
