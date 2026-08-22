import type { RepoUpdate } from "@/ipc/generated/RepoUpdate";
import { onRepoSnapshotUpdated } from "@/ipc/events";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { recordBulkResult } from "./results";
import { useRepoStore } from "./useRepoStore";

/*
 * イベントの受け口。
 *
 * **購読を張るのはここ。** features の `useEffect` で購読すると、
 * `revision` の比較を通す場所が 2 箇所に分かれる (docs/architecture.md)。
 */

/** 一括フェッチの 1 件分を反映する */
export function applyRepoUpdate(update: RepoUpdate): void {
  const repos = useRepoStore.getState();
  if (update.outcome !== null) {
    const { snapshot, snapshot_error: failure, result } = update.outcome;
    if (snapshot !== null) {
      // 古い世代はストア側が捨てる
      repos.applySnapshot(snapshot);
    } else {
      repos.failRepo(update.repo_id, failure ?? "状態を読み直せませんでした");
    }
    recordBulkResult(update.repo_id, result);
  } else {
    // 状態そのものが読めなかった。見出しに理由を出して、行は消さない
    const message = update.error ?? "不明なエラー";
    repos.failRepo(update.repo_id, message);
    recordBulkResult(update.repo_id, { kind: "direct", ok: false, steps: [], message });
  }
  // 実行中の印は投入時に付けている (store/opsActions.ts)
  repos.endRun(update.repo_id);
}

/**
 * 生きている購読の本数。
 *
 * **1 本も無いと一括フェッチの結果が届かない。** 実行中の印を付けたまま
 * イベントを待つと、そのリポジトリの操作系が永久に無効になるので、
 * 投げる側 (`store/opsActions.ts`) がここを見て形を変える。
 *
 * 真偽値ではなく数える。StrictMode の二重マウントでは購読が 2 本張られ、
 * 解決の順番によっては**生きている購読を持ったまま false になる**。
 */
let subscriptions = 0;

export function isListeningForRepoUpdates(): boolean {
  return subscriptions > 0;
}

/** 購読を張る。戻り値を呼ぶと外れる (2 回呼んでも 1 回分) */
export async function listenForRepoUpdates(): Promise<UnlistenFn> {
  const unlisten = await onRepoSnapshotUpdated(applyRepoUpdate);
  subscriptions += 1;
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subscriptions -= 1;
    unlisten();
  };
}

/** テスト用。購読の状態を戻す */
export function resetListening(): void {
  subscriptions = 0;
}
