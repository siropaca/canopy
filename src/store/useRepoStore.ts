import { create, type StateCreator } from "zustand";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoId, RepoState } from "@/ipc/types";
import type { Activity } from "@/shared/lib/activity";

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
   * リポジトリごとに走っている書き込みの列。**「実行中」の正はここだけ。**
   *
   * 列にするのは、一括フェッチとユーザーの操作が重なったときに、
   * 真偽値だと先に終わった方が実行中の表示を消してしまうため。
   * **中身の操作はステータスバーの文言に使う**
   * (docs/adr/0023-progress-in-the-status-bar.md)。
   *
   * `RepoState.running` はこの列から `orderedRepos` が写す。
   * `byId` の側を手で同期すると、`RepoState` を作り直す経路を足すたびに
   * 写し忘れが増える。
   */
  readonly running: ReadonlyMap<RepoId, readonly Activity[]>;
  /**
   * 取り直しの最中のリポジトリ。
   *
   * **`running` とは分ける。** 取り直しは `.git` の変化のたびに走るので
   * (docs/adr/0022-auto-refresh.md)、混ぜるとボタンが頻繁に無効になる。
   * 使うのはステータスバーの文言と、読み取りの重複排除だけ。
   *
   * **入るのは「更新」の 3 つの引き金から走った読み取りだけ** (`store/refresh.ts`)。
   * 起動時の全件読み込みと、追加した直後の読み込みは入らない。そちらは
   * 見出しの `読み込み中` で見せている (docs/specs/ui.md の「読み込み中とエラー」)。
   */
  readonly reading: ReadonlySet<RepoId>;

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
  beginRun: (repoId: RepoId, activity: Activity) => void;
  /**
   * 操作が終わった。最後の 1 本が終わったときだけ無効化を解く。
   *
   * **終わった操作を名指しで渡す。** 末尾を抜くと、種別の違う 2 本が重なったときに
   * 残る側がずれて、ステータスバーが走っていない操作を出す。
   */
  endRun: (repoId: RepoId, activity: Activity) => void;
  /** 取り直しを始めた。**無効化はしない** */
  beginRead: (repoId: RepoId) => void;
  endRead: (repoId: RepoId) => void;
}

const creator: StateCreator<RepoStoreState> = (set) => ({
  byId: new Map(),
  order: [],
  loaded: false,
  loadError: null,
  running: new Map(),
  reading: new Set(),

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
      // 消したリポジトリの実行中を残さない。残すと操作系が永久に無効になる
      const running = new Map(state.running);
      running.delete(repoId);
      const reading = new Set(state.reading);
      reading.delete(repoId);
      return { byId, order: state.order.filter((id) => id !== repoId), running, reading };
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

  beginRun: (repoId, activity) =>
    set((state) => {
      const next = new Map(state.running);
      next.set(repoId, [...(state.running.get(repoId) ?? []), activity]);
      return { running: next };
    }),

  endRun: (repoId, activity) =>
    set((state) => {
      const kinds = state.running.get(repoId);
      if (kinds === undefined) return {};
      // **終わった 1 本を名指しで抜く。** 同じ種別が 2 本あれば後から始めた方
      const at = kinds.lastIndexOf(activity);
      if (at === -1) return {};
      const next = new Map(state.running);
      const rest = [...kinds.slice(0, at), ...kinds.slice(at + 1)];
      // 空になった id は残さない
      if (rest.length === 0) next.delete(repoId);
      else next.set(repoId, rest);
      return { running: next };
    }),

  beginRead: (repoId) =>
    set((state) => {
      if (state.reading.has(repoId)) return {};
      return { reading: new Set(state.reading).add(repoId) };
    }),

  endRead: (repoId) =>
    set((state) => {
      if (!state.reading.has(repoId)) return {};
      const next = new Set(state.reading);
      next.delete(repoId);
      return { reading: next };
    }),
});

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
 * 実行中を写した `RepoState` の控え。
 *
 * **呼ぶたびに作り直さない。** `orderedRepos` は描画のたびに呼ばれるので、
 * 毎回新しいオブジェクトを返すと `useShallow` の比較が必ず外れて、
 * 再描画 -> 比較 -> 再描画 が止まらなくなる (実機で画面が真っ白になった)。
 *
 * `byId` の側は常に `running: false` なので、控えは 1 リポジトリにつき 1 つで足りる。
 */
const runningViews = new WeakMap<RepoState, RepoState>();

function withRunning(repo: RepoState, running: boolean): RepoState {
  if (repo.running === running) return repo;
  const cached = runningViews.get(repo);
  if (cached !== undefined && cached.running === running) return cached;
  const view = { ...repo, running };
  runningViews.set(repo, view);
  return view;
}

/**
 * そのリポジトリに実行中の操作があるか。
 *
 * **本数から真偽値に変える式はここ 1 本。** 2 箇所で書くと、定義を変えたときに
 * 片方だけ古くなる。サイドバーは実行中として無効なのに、取り直しは実行中でないと
 * 判断して読みに行く、という食い違いになる。
 */
export function isRunning(state: RepoStoreState, repoId: RepoId): boolean {
  return (state.running.get(repoId) ?? []).length > 0;
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
    // 同じ状態なら同じオブジェクトを返す。useShallow の比較を無駄に外さない
    repos.push(withRunning(repo, isRunning(state, id)));
  }
  return repos;
}

export const useRepoStore = create<RepoStoreState>()(creator);

/** テスト用に独立したストアを作る */
export const createRepoStore = () => create<RepoStoreState>()(creator);
