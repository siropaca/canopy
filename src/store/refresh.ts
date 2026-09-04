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
  await Promise.all(ids.filter(shouldRead).map((id) => refreshOne(id)));
}

/**
 * いま読んでよいか。
 *
 * **判定はここ 1 本。** やり直しの側で書き直すと、片方だけ古くなる。
 */
function shouldRead(repoId: RepoId): boolean {
  const repos = useRepoStore.getState();
  return repos.byId.has(repoId) && !isRunning(repos, repoId);
}

/**
 * 1 件を読む。読んでいる最中なら、終わってから 1 回だけやり直す。
 *
 * **読み取りには重複排除が無い。** 書き込みは `GitQueue::try_claim` が連打を
 * 弾くが (docs/adr/0009-concurrency-and-refresh.md)、`get_repo_snapshot` は
 * 投げた分だけ Rust 側に届く。「更新」を 10 回押すと 11 リポジトリ × 10 本が
 * 読み取りの枠 4 本を埋めて、その間チェックアウト後の取り直しまで待たされる。
 *
 * 読んでいる最中はストアの `reading` に入る。ステータスバーがそれを出す
 * (docs/adr/0023-progress-in-the-status-bar.md)。
 */
async function refreshOne(repoId: RepoId): Promise<void> {
  if (useRepoStore.getState().reading.has(repoId)) {
    askedAgain.add(repoId);
    return;
  }
  // **繰り返しにする。** 再帰にすると、変化が続いている間ずっと
  // `refreshOne` のフレームが 1 段ずつ積み上がる
  for (;;) {
    useRepoStore.getState().beginRead(repoId);
    try {
      await loadSnapshot(repoId);
    } finally {
      useRepoStore.getState().endRead(repoId);
    }
    // **やり直す前にもう一度見る。** 読んでいる間にリストから消えたり、
    // 書き込みが始まったりする (docs/adr/0022-auto-refresh.md)
    if (!askedAgain.delete(repoId) || !shouldRead(repoId)) return;
  }
}

/** テスト用。やり直しの覚えを戻す */
export function resetRefreshing(): void {
  askedAgain.clear();
}
