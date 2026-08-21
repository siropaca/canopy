import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { EVENTS } from "./commands";
import type { RepoUpdate } from "./generated/RepoUpdate";

/*
 * イベント購読の薄いラッパ。
 *
 * **購読を張るのは `store/` 側。** features の `useEffect` で購読すると、
 * `revision` の比較を通す場所が 2 箇所に分かれる (docs/architecture.md)。
 */

/** 一括フェッチの結果を 1 件ずつ受ける */
export function onRepoSnapshotUpdated(handle: (update: RepoUpdate) => void): Promise<UnlistenFn> {
  return listen<RepoUpdate>(EVENTS.repoSnapshotUpdated, (event) => {
    handle(event.payload);
  });
}
