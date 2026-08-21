import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import type { RepoId } from "@/ipc/types";
import * as ipc from "@/ipc/repos";
import { messageOf } from "@/shared/lib/errorMessage";
import { defaultExpanded } from "@/shared/lib/treeKeys";

import { useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

/*
 * 起動と登録の流れ。
 *
 * 1. 保存してある一覧と UI 状態を読む
 * 2. **見出しを全件すぐ描く** (中身は loading)
 * 3. 各リポジトリを並列に読み取り、届いた分から埋める
 *
 * 同時実行数は Rust 側の semaphore で絞る
 * (docs/adr/0009-concurrency-and-refresh.md)。
 */

/** 起動時の読み込み */
export async function loadEverything(): Promise<void> {
  const repos = useRepoStore.getState();
  let registrations: RepoRegistration[];
  try {
    const [listed, uiState] = await Promise.all([ipc.listRepos(), ipc.getUiState()]);
    registrations = listed;
    useUiStore.getState().hydrate(uiState);
    repos.registerAll(listed);
    repos.setLoadError(null);
  } catch (error) {
    // 設定が読めないと一覧も UI 状態も無い。理由を画面に出す
    repos.setLoadError(messageOf(error));
    return;
  }

  await Promise.all(registrations.map((repo) => loadSnapshot(repo.id)));
}

/**
 * リポジトリごとの、いま有効な読み取り要求。
 *
 * **失敗には世代が付かない。** スナップショットは `revision` で古いものを捨てられるが、
 * 失敗は「どの世代の失敗か」が分からないので、要求の番号で「最後の 1 本」だけを採る。
 * これが無いと、2 本走ったときに古い失敗が新しい結果を消す。
 */
const latestRequest = new Map<RepoId, number>();

/** 1 リポジトリ分を読み直す。失敗はそのリポジトリだけに閉じる */
export async function loadSnapshot(repoId: RepoId): Promise<void> {
  const request = (latestRequest.get(repoId) ?? 0) + 1;
  latestRequest.set(repoId, request);

  const repos = useRepoStore.getState();
  try {
    const snapshot = await ipc.getRepoSnapshot(repoId);
    if (latestRequest.get(repoId) !== request) return;
    repos.applySnapshot(snapshot);
  } catch (error) {
    if (latestRequest.get(repoId) !== request) return;
    repos.failRepo(repoId, messageOf(error));
  }
}

/** テスト用。要求の番号を初期化する */
export function resetRequests(): void {
  latestRequest.clear();
}

/**
 * フォルダを選んで登録する。
 *
 * 登録できなかった理由は Rust 側が OS のダイアログで見せる。
 * **既定の展開を当てるのはここだけ。** 毎回当てると、ユーザーが閉じた状態が
 * 起動のたびに戻ってしまう (docs/shared/lib/treeKeys.ts の `defaultExpanded`)。
 */
export async function addRepository(): Promise<void> {
  const outcome = await ipc.addRepo();
  if (outcome.kind !== "added") return;

  useRepoStore.getState().register(outcome.repo);
  await loadSnapshot(outcome.repo.id);

  const snapshot = useRepoStore.getState().byId.get(outcome.repo.id)?.snapshot;
  if (snapshot !== null && snapshot !== undefined) {
    useUiStore.getState().openKeys(defaultExpanded(outcome.repo.id, snapshot));
  }
}

/** 一覧から削除する。ディスクには触らない */
export async function removeRepository(repoId: RepoId): Promise<void> {
  await ipc.removeRepo(repoId);
  useRepoStore.getState().remove(repoId);
  useUiStore.getState().select(null);
}
