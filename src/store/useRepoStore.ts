import { create, type StateCreator } from "zustand";

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
}

const creator: StateCreator<RepoStoreState> = (set) => ({
  byId: new Map(),
  order: [],
  loaded: false,
  loadError: null,

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
      return { byId, order: state.order.filter((id) => id !== repoId) };
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
});

function toLoading(repo: RepoRegistration): RepoState {
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    status: "loading",
    snapshot: null,
    error: null,
  };
}

/** 並び順どおりのリポジトリ */
export function orderedRepos(state: RepoStoreState): RepoState[] {
  const repos: RepoState[] = [];
  for (const id of state.order) {
    const repo = state.byId.get(id);
    if (repo !== undefined) repos.push(repo);
  }
  return repos;
}

export const useRepoStore = create<RepoStoreState>()(creator);

/** テスト用に独立したストアを作る */
export const createRepoStore = () => create<RepoStoreState>()(creator);
