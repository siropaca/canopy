import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { EVENTS } from "./commands";
import type { RepoId } from "./types";
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

/**
 * `.git` が変わったリポジトリを受ける。
 *
 * **1 件ずつではなくまとめて届く。** git の 1 操作で `.git` の中の何十ファイルも
 * 動くので、Rust 側で畳んでいる (docs/adr/0022-auto-refresh.md)。
 */
export function onReposChanged(handle: (repoIds: RepoId[]) => void): Promise<UnlistenFn> {
  return listen<RepoId[]>(EVENTS.reposChanged, (event) => {
    handle(event.payload);
  });
}
