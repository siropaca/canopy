import type { RepoUpdate } from "@/ipc/generated/RepoUpdate";
import { onRepoSnapshotUpdated, onReposChanged } from "@/ipc/events";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { noteWindowVisible } from "./consoleActions";
import { refreshAllRepositories, refreshRepositories } from "./refresh";
import { recordBulkResult, wasAbandoned } from "./results";
import { useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

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
  // 実行中の印は投入時に付けている (store/opsActions.ts)。
  // **畳んだ分はそのときに外している。** ここでもう一度外すと、その時点で
  // 別の操作が握っている 1 本を消す (store/results.ts)
  if (!wasAbandoned(update.repo_id)) repos.endRun(update.repo_id);
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

/**
 * `.git` の変化を受けて取り直す購読を張る。戻り値を呼ぶと外れる。
 *
 * **まとめて届く。** 畳むのは Rust 側 (docs/adr/0022-auto-refresh.md)。
 * ここで受けた分は、実行中でないリポジトリだけ読み直す。
 *
 * **隠れている間は捨てる。** 閉じてもプロセスは残るので、見ていない間も
 * イベントは届き続ける (docs/adr/0011-residency.md)。そのたびに git を
 * 起こすと、画面に出ない読み取りが走り続ける。前面に戻ったときに全件
 * 読み直すので取りこぼさない。
 */
export function listenForRepoChanges(): Promise<UnlistenFn> {
  return onReposChanged((repoIds) => {
    if (!useUiStore.getState().windowVisible) return;
    void refreshRepositories(repoIds);
  });
}

/**
 * ウィンドウが画面に出ているかを追う。
 *
 * 閉じてもプロセスは残るので、隠している間にも結果が届く
 * (docs/adr/0011-residency.md)。
 *
 * **`visibilitychange` を使う。** Rust から送ると、こちらが `hide()` した経路しか
 * 拾えない。`Cmd+H`・最小化・別のデスクトップへの切り替えは Tauri のウィンドウ
 * イベントに出てこないが、WebView の可視性としては全部届く (実測)。
 *
 * **戻ってきたら取り直す** (docs/adr/0022-auto-refresh.md)。隠れている間に
 * ターミナルで動かした結果を映す。張った時点では取り直さない。
 * 起動直後は `loadEverything` が全件読んでいる。
 */
export function watchWindowVisibility(): () => void {
  let hidden = false;
  const apply = () => {
    const visible = document.visibilityState === "visible";
    noteWindowVisible(visible);
    if (visible && hidden) void refreshAllRepositories();
    hidden = !visible;
  };
  // 起動時に既に隠れていることもある
  apply();
  document.addEventListener("visibilitychange", apply);
  return () => {
    document.removeEventListener("visibilitychange", apply);
  };
}

/** テスト用。購読の状態を戻す */
export function resetListening(): void {
  subscriptions = 0;
}
