import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoState } from "@/ipc/types";

/*
 * 集計。数え方は docs/specs/ui.md の「ステータスバー」と「リポジトリ見出し」。
 * 表示は features 側、計算はここ。
 */

/** リポジトリ 1 件分の集計 */
export interface RepoTotals {
  readonly local: number;
  readonly remote: number;
  /** ローカルブランチの behind の合計。ブランチ数ではない */
  readonly behind: number;
  readonly ahead: number;
  /** **メインのワークツリーの**変更ファイル数。他のワークツリーは含めない */
  readonly dirty: number;
  /** メイン以外のワークツリーの数 */
  readonly worktrees: number;
}

export function repoTotals(snapshot: RepoSnapshot): RepoTotals {
  let behind = 0;
  let ahead = 0;
  for (const branch of snapshot.local) {
    behind += branch.behind;
    ahead += branch.ahead;
  }
  return {
    local: snapshot.local.length,
    remote: snapshot.remote.length,
    behind,
    ahead,
    dirty: snapshot.changes.total,
    worktrees: snapshot.worktrees.length,
  };
}

/** ステータスバーに出す集計 */
export interface StatusSummary {
  readonly repos: number;
  readonly local: number;
  readonly remote: number;
  readonly behind: number;
  /** behind が 1 以上あるリポジトリ数 */
  readonly behindRepos: number;
  readonly ahead: number;
  readonly aheadRepos: number;
  /** メインのワークツリーに変更があるリポジトリ数 */
  readonly dirtyRepos: number;
  readonly worktrees: number;
}

/**
 * 全リポジトリの集計。
 *
 * **1 件でも読み込み中なら `null` を返す。** 0 -> 途中 -> 確定と 2 回跳ねるのを
 * 避けるため、揃うまで `-` を出す (docs/specs/ui.md)。
 * エラーのリポジトリは待たない。読み込みが終わらないので永久に `-` になる。
 */
export function summarize(repos: readonly RepoState[]): StatusSummary | null {
  if (repos.some((repo) => repo.status === "loading")) return null;

  const summary = {
    repos: repos.length,
    local: 0,
    remote: 0,
    behind: 0,
    behindRepos: 0,
    ahead: 0,
    aheadRepos: 0,
    dirtyRepos: 0,
    worktrees: 0,
  };
  for (const repo of repos) {
    if (repo.snapshot === null) continue;
    const totals = repoTotals(repo.snapshot);
    summary.local += totals.local;
    summary.remote += totals.remote;
    summary.behind += totals.behind;
    summary.ahead += totals.ahead;
    summary.worktrees += totals.worktrees;
    if (totals.behind > 0) summary.behindRepos += 1;
    if (totals.ahead > 0) summary.aheadRepos += 1;
    if (totals.dirty > 0) summary.dirtyRepos += 1;
  }
  return summary;
}
