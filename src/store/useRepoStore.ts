import { create, type StateCreator } from "zustand";

import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoId, RepoState } from "@/ipc/types";

/*
 * リポジトリの状態。
 *
 * `Map<RepoId, RepoState>` と並び順を分けて持つ (docs/architecture.md)。
 * 見出しは登録情報だけで描けるので、中身は届いた分から埋める。
 */

export interface RepoStoreState {
  readonly byId: ReadonlyMap<RepoId, RepoState>;
  readonly order: readonly RepoId[];
  /**
   * 一覧を読み終えたか。
   *
   * **「まだ読んでいない」と「0 件登録されている」を分ける。**
   * 分けないと、起動直後の 1 フレームだけ合計が 0 で描かれて
   * 0 -> 途中 -> 確定と 2 回跳ねる (docs/specs/ui.md)。
   */
  readonly loaded: boolean;
  /** 設定ファイルが読めなかったときの理由 */
  readonly loadError: string | null;
  /**
   * リポジトリごとの、直近の操作の結果。
   *
   * コンソールとトーストはフェーズ 3 なので、いまは詳細ペインの
   * 「最後の結果」欄がここを読む (docs/plans/phase-2-write.md)。
   */
  readonly lastResult: ReadonlyMap<RepoId, CommandResult>;
  /**
   * リポジトリごとの実行中の本数。**「実行中」の正はここだけ。**
   *
   * 数えるのは、一括フェッチとユーザーの操作が重なったときに、
   * 真偽値だと先に終わった方が実行中の表示を消してしまうため。
   *
   * `RepoState.running` はこの本数から `orderedRepos` が写す。
   * `byId` の側を手で同期すると、`RepoState` を作り直す経路を足すたびに
   * 写し忘れが増える。
   */
  readonly running: ReadonlyMap<RepoId, number>;

  /** 起動時。見出しを全件すぐ描くために登録情報だけ入れる */
  registerAll: (repos: readonly RepoRegistration[]) => void;
  /** 追加した 1 件 */
  register: (repo: RepoRegistration) => void;
  /** スナップショットが届いた。**古い世代は捨てる** */
  applySnapshot: (snapshot: RepoSnapshot) => void;
  /** 取得に失敗した。全体は落とさない */
  failRepo: (repoId: RepoId, error: string) => void;
  remove: (repoId: RepoId) => void;
  setOrder: (order: readonly RepoId[]) => void;
  setLoadError: (error: string | null) => void;
  /** 操作を始めた。そのリポジトリの操作系 UI を無効にする */
  beginRun: (repoId: RepoId) => void;
  /** 操作が終わった。最後の 1 本が終わったときだけ無効化を解く */
  endRun: (repoId: RepoId) => void;
  /** 直近の操作の結果を覚える */
  setResult: (repoId: RepoId, result: CommandResult) => void;
}

const creator: StateCreator<RepoStoreState> = (set) => ({
  byId: new Map(),
  order: [],
  loaded: false,
  loadError: null,
  lastResult: new Map(),
  running: new Map(),

  registerAll: (repos) =>
    set(() => ({
      byId: new Map(repos.map((repo) => [repo.id, toLoading(repo)])),
      order: repos.map((repo) => repo.id),
      loaded: true,
    })),

  register: (repo) =>
    set((state) => {
      const byId = new Map(state.byId);
      byId.set(repo.id, toLoading(repo));
      const order = state.order.includes(repo.id) ? state.order : [...state.order, repo.id];
      return { byId, order };
    }),

  applySnapshot: (snapshot) =>
    set((state) => {
      const current = state.byId.get(snapshot.id);
      if (current === undefined) return {};
      // invoke の解決順は発行順と一致しない。古い世代で上書きしない
      // (docs/adr/0009-concurrency-and-refresh.md)
      if (current.snapshot !== null && current.snapshot.revision >= snapshot.revision) {
        return {};
      }
      const byId = new Map(state.byId);
      byId.set(snapshot.id, {
        ...current,
        name: snapshot.name,
        path: snapshot.path,
        status: "ready",
        snapshot,
        error: null,
      });
      return { byId };
    }),

  failRepo: (repoId, error) =>
    set((state) => {
      const current = state.byId.get(repoId);
      if (current === undefined) return {};
      const byId = new Map(state.byId);
      byId.set(repoId, { ...current, status: "error", snapshot: null, error });
      return { byId };
    }),

  remove: (repoId) =>
    set((state) => {
      const byId = new Map(state.byId);
      byId.delete(repoId);
      // 消したリポジトリの結果と実行中を残さない。残すと id を使い回したときに混ざる
      const lastResult = new Map(state.lastResult);
      lastResult.delete(repoId);
      const running = new Map(state.running);
      running.delete(repoId);
      return {
        byId,
        order: state.order.filter((id) => id !== repoId),
        lastResult,
        running,
      };
    }),

  setOrder: (order) =>
    set((state) => ({
      // 知らない id は無視する。登録済みで渡されなかった id は末尾に残す
      order: [
        ...order.filter((id) => state.byId.has(id)),
        ...state.order.filter((id) => !order.includes(id)),
      ],
    })),

  // 読めなかったのも「読み終えた」。待ち続けさせない
  setLoadError: (error) => set(() => ({ loadError: error, loaded: true })),

  beginRun: (repoId) => set((state) => ({ running: shifted(state.running, repoId, 1) })),

  endRun: (repoId) => set((state) => ({ running: shifted(state.running, repoId, -1) })),

  setResult: (repoId, result) =>
    set((state) => {
      if (!state.byId.has(repoId)) return {};
      const lastResult = new Map(state.lastResult);
      lastResult.set(repoId, result);
      return { lastResult };
    }),
});

/** 実行中の本数を動かす。0 になった id は残さない */
function shifted(
  running: ReadonlyMap<RepoId, number>,
  repoId: RepoId,
  delta: number,
): ReadonlyMap<RepoId, number> {
  const next = new Map(running);
  const after = Math.max(0, (running.get(repoId) ?? 0) + delta);
  if (after === 0) {
    next.delete(repoId);
  } else {
    next.set(repoId, after);
  }
  return next;
}

function toLoading(repo: RepoRegistration): RepoState {
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    status: "loading",
    snapshot: null,
    error: null,
    // `orderedRepos` が本数から写す。ここでは持たない
    running: false,
  };
}

/**
 * 並び順どおりのリポジトリ。**実行中の本数をここで写す。**
 *
 * 写すのを 1 箇所にしておかないと、`RepoState` を作り直す経路を足すたびに
 * 写し忘れが増える。落とせば操作系が実行中に有効なままになり、
 * 逆に消し忘れれば永久に無効になる。
 */
export function orderedRepos(state: RepoStoreState): RepoState[] {
  const repos: RepoState[] = [];
  for (const id of state.order) {
    const repo = state.byId.get(id);
    if (repo === undefined) continue;
    const running = (state.running.get(id) ?? 0) > 0;
    // 同じなら同じオブジェクトを返す。useShallow の比較を無駄に外さない
    repos.push(repo.running === running ? repo : { ...repo, running });
  }
  return repos;
}

export const useRepoStore = create<RepoStoreState>()(creator);

/** テスト用に独立したストアを作る */
export const createRepoStore = () => create<RepoStoreState>()(creator);
