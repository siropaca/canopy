import { create, type StateCreator } from "zustand";

import type { RepoId } from "@/ipc/types";

/*
 * 一括フェッチの進み具合。
 *
 * **リポジトリごとにトーストを出さない。** 11 件出すと上限 6 を超えて
 * 失敗のトーストが押し出される (docs/specs/ui.md の「トースト」)。
 * 1 件に集約するために、対象と届いた結果をここで数える。
 *
 * 実行中は「すべてフェッチ」を無効にするので、**残りの正はここ 1 本**。
 * 結果を流し込むのは `store/results.ts`。
 */

export interface BulkFetchStoreState {
  /** 結果を待っているリポジトリ */
  readonly targets: ReadonlySet<RepoId>;
  /** 結果が届いたリポジトリ */
  readonly done: ReadonlySet<RepoId>;
  /** そのうち失敗したリポジトリ */
  readonly failures: ReadonlySet<RepoId>;

  /** 投げる前に対象を決める。**投げてからでは結果に間に合わない** */
  start: (ids: readonly RepoId[]) => void;
  /**
   * 実際に走った一覧に合わせる。
   *
   * 投げる前は登録済みの全件を対象にするしかないので、Rust が返した一覧で
   * 差を埋める。外れた id を待ち続けるとボタンが永久に無効になる。
   */
  retarget: (ids: readonly RepoId[]) => void;
  /** 1 件ぶんの結果。対象でなければ (または二度目なら) `false` */
  note: (repoId: RepoId, ok: boolean) => boolean;
  reset: () => void;
}

const creator: StateCreator<BulkFetchStoreState> = (set, get) => ({
  targets: new Set(),
  done: new Set(),
  failures: new Set(),

  start: (ids) => set(() => ({ targets: new Set(ids), done: new Set(), failures: new Set() })),

  retarget: (ids) =>
    set((state) => {
      // **走っていないときは何もしない。** 集約が済んだあとに遅れて届くと、
      // 空の `done` に対して対象が復活して「実行中」が固定される
      if (state.targets.size === 0) return {};
      const targets = new Set(ids);
      return {
        targets,
        // 対象から外れたリポジトリの結果は集計に入れない
        done: intersect(state.done, targets),
        failures: intersect(state.failures, targets),
      };
    }),

  note: (repoId, ok) => {
    const state = get();
    if (!state.targets.has(repoId) || state.done.has(repoId)) return false;
    const done = new Set(state.done);
    done.add(repoId);
    const failures = new Set(state.failures);
    if (!ok) failures.add(repoId);
    set(() => ({ done, failures }));
    return true;
  },

  reset: () => set(() => ({ targets: new Set(), done: new Set(), failures: new Set() })),
});

function intersect(values: ReadonlySet<RepoId>, keep: ReadonlySet<RepoId>): Set<RepoId> {
  return new Set([...values].filter((value) => keep.has(value)));
}

/** 結果を待っている最中か。ボタンの無効条件 */
export function bulkFetchRunning(state: BulkFetchStoreState): boolean {
  return state.targets.size > 0 && state.done.size < state.targets.size;
}

/** 全件そろったか。集約したトーストを出す合図 */
export function bulkFetchSettled(state: BulkFetchStoreState): boolean {
  return state.targets.size > 0 && state.done.size >= state.targets.size;
}

/** 集約したトーストの文言 */
export function bulkFetchSummary(state: BulkFetchStoreState): string {
  const summary = `${state.targets.size} リポジトリをフェッチしました`;
  return state.failures.size === 0 ? summary : `${summary} (失敗 ${state.failures.size})`;
}

export const useBulkFetchStore = create<BulkFetchStoreState>()(creator);
