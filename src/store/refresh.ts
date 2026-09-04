import type { RepoId } from "@/ipc/types";

import { loadSnapshot } from "./bootstrap";
import { isRunning, useRepoStore } from "./useRepoStore";

/*
 * 更新 (docs/adr/0022-auto-refresh.md)。
 *
 * 引き金は 3 つある。サイドバーの「更新」、ウィンドウが前面に戻ったとき、
 * `.git` が変わったとき。**落ちる先はここ 1 本にする。**
 * 分けて書くと、どれか 1 つだけ実行中を飛ばさない、という壊れ方をする。
 *
 * **フェッチはしない。** ターミナルで動かした結果を映すのが目的で、
 * リモートに聞きに行く必要は無い (ADR-0022)。
 */

/**
 * いま読んでいるリポジトリ。
 *
 * **読み取りには重複排除が無い。** 書き込みは `GitQueue::try_claim` が連打を
 * 弾くが (docs/adr/0009-concurrency-and-refresh.md)、`get_repo_snapshot` は
 * 投げた分だけ Rust 側に届く。「更新」を 10 回押すと 11 リポジトリ × 10 本が
 * 読み取りの枠 4 本を埋めて、その間チェックアウト後の取り直しまで待たされる。
 */
const reading = new Set<RepoId>();

/**
 * 読んでいる最中に、もう一度求められたリポジトリ。
 *
 * **捨てずに 1 回だけやり直す。** 走っている読み取りは要求より前の状態を
 * 見ているかもしれないので、単に飛ばすと最後の変化を取りこぼす。
 */
const askedAgain = new Set<RepoId>();

/** 登録済みを全件取り直す */
export function refreshAllRepositories(): Promise<void> {
  return refreshRepositories(useRepoStore.getState().order);
}

/**
 * 渡したリポジトリを取り直す。
 *
 * **実行中のリポジトリは読まない。** 操作の側が終わったときに同じロックの中で
 * 取り直している (docs/adr/0009-concurrency-and-refresh.md)。ここでも読むと、
 * 同じリポジトリの読み取りが二重に走る。
 *
 * 知らない id も読まない。監視のイベントは、リストから消したあとに遅れて届き得る。
 */
export async function refreshRepositories(ids: readonly RepoId[]): Promise<void> {
  const repos = useRepoStore.getState();
  const targets = ids.filter((id) => repos.byId.has(id) && !isRunning(repos, id));
  await Promise.all(targets.map((id) => refreshOne(id)));
}

/** 1 件を読む。読んでいる最中なら、終わってから 1 回だけやり直す */
async function refreshOne(repoId: RepoId): Promise<void> {
  if (reading.has(repoId)) {
    askedAgain.add(repoId);
    return;
  }
  reading.add(repoId);
  try {
    await loadSnapshot(repoId);
  } finally {
    reading.delete(repoId);
  }
  // やり直しは 1 回で足りる。**再帰は 2 段までしか深くならない**
  if (askedAgain.delete(repoId)) await refreshOne(repoId);
}

/** テスト用。読んでいる最中の覚えを戻す */
export function resetRefreshing(): void {
  reading.clear();
  askedAgain.clear();
}
