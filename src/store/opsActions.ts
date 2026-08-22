import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { OpOutcome } from "@/ipc/generated/OpOutcome";
import type { PushPreview } from "@/ipc/generated/PushPreview";
import type { RepoId, RowNode } from "@/ipc/types";
import * as ipc from "@/ipc/ops";
import { messageOf } from "@/shared/lib/errorMessage";

import { isListeningForRepoUpdates } from "./events";
import {
  cancelBulkFetch,
  recordBulkResult,
  recordResult,
  retargetBulkFetch,
  startBulkFetch,
} from "./results";
import { orderedRepos, useRepoStore } from "./useRepoStore";

/*
 * 操作の実行。
 *
 * 「操作 → 取り直し → 再描画」の一方向に統一する。**楽観的更新はしない**
 * (docs/architecture.md)。Rust が `{ result, snapshot }` を 1 度で返すので、
 * 取り直しのために 2 回目の invoke を投げない。
 *
 * 実行中はそのリポジトリの操作系 UI を無効にする。始めと終わりをここで挟む
 * (docs/specs/ui.md の「実行中の扱い」)。
 */

/**
 * 実行中の印を付けて操作を走らせ、結果とスナップショットを反映する。
 *
 * 結果の出し先 (コンソールとトースト) は `store/results.ts` の 1 本
 * (docs/specs/ui.md の「コンソール」「トースト」)。
 * 一括フェッチの 1 件として走るときだけ `record` を差し替える。
 */
async function perform(
  repoId: RepoId,
  call: () => Promise<OpOutcome>,
  record: (repoId: RepoId, result: CommandResult) => void = recordResult,
): Promise<CommandResult> {
  const repos = useRepoStore.getState();
  repos.beginRun(repoId);
  try {
    const outcome = await call();
    if (outcome.snapshot !== null) {
      // 古い世代は捨てる。判定はストア側の 1 箇所
      repos.applySnapshot(outcome.snapshot);
    } else {
      // 実行はできたが状態を読み直せなかった。見出しに理由を出す
      repos.failRepo(repoId, outcome.snapshot_error ?? "状態を読み直せませんでした");
    }
    // **取り直しに失敗しても実行した git の出力は残す**
    record(repoId, outcome.result);
    return outcome.result;
  } catch (error) {
    // アプリ側の異常 (ディレクトリが消えた、参照名が弾かれた)。握りつぶさない
    const failed = failure(messageOf(error));
    record(repoId, failed);
    return failed;
  } finally {
    repos.endRun(repoId);
  }
}

/**
 * アプリ側の異常。git を実行していないのでコンソールに出す段は無い。
 *
 * `kind` を `direct` にするのは、コンソールが「段が無い行」をどう描くかを
 * `steps` の長さではなく `kind` で決められるようにするため
 * (docs/adr/0018-command-result-steps.md)。
 */
function failure(message: string): CommandResult {
  return { kind: "direct", ok: false, steps: [], message };
}

export function fetchRepository(repoId: RepoId): Promise<CommandResult> {
  return perform(repoId, () => ipc.fetchRepo(repoId));
}

/**
 * 全リポジトリをフェッチする。
 *
 * **11 本の invoke を並列に投げない。** Rust が 1 件ずつ
 * `repo_snapshot_updated` を送るので、実行中の印だけここで付けて、
 * 解くのは `store/events.ts` (docs/adr/0009-concurrency-and-refresh.md)。
 *
 * 購読が張れていないときだけ 1 件ずつ投げる形に落とす。イベントが来ない状態で
 * 印を付けると、そのリポジトリの操作系が**永久に無効**になる。
 *
 * **落ちた先では順に投げる。** 並列に投げるとネットワークの枠 4 本を
 * 一括フェッチが占めて、対話操作のために空けてある枠が無くなる
 * (docs/adr/0009-concurrency-and-refresh.md)。
 *
 * **実行中の印は invoke を投げる前に付ける。** 後に付けると、先に届いた
 * イベントの `endRun` が 0 で潰れてから `beginRun` が 1 に上げるので、
 * 印が永久に残る。ディレクトリが消えているリポジトリは git を起こす前に
 * 失敗するので、この順序は実際に起こり得る。
 */
export async function fetchAllRepositories(): Promise<RepoId[]> {
  const repos = useRepoStore.getState();
  const known = orderedRepos(repos).map((repo) => repo.id);
  // **集計も投げる前に始める。** イベントは invoke の解決より先に届き得る
  startBulkFetch(known);
  if (!isListeningForRepoUpdates()) {
    for (const id of known) {
      await perform(id, () => ipc.fetchRepo(id), recordBulkResult);
    }
    return known;
  }

  for (const id of known) repos.beginRun(id);
  let ids: RepoId[];
  try {
    ids = await ipc.fetchAll();
  } catch (error) {
    // 一覧が引けないのはリポジトリ個別の話ではない。読み込みエラーとして出す
    for (const id of known) repos.endRun(id);
    cancelBulkFetch();
    repos.setLoadError(messageOf(error));
    return [];
  }
  // 対象から外れた id の印は自分で解く。イベントは来ない
  for (const id of known) {
    if (!ids.includes(id)) repos.endRun(id);
  }
  // 知らなかった id が返ってきたら、その分の印を付ける
  for (const id of ids) {
    if (!known.includes(id)) repos.beginRun(id);
  }
  // 実際に走った一覧に合わせる。外れた id を待ち続けるとボタンが戻らない
  retargetBulkFetch(ids);
  return ids;
}

/**
 * 選択対象をプルする。
 *
 * 現在のブランチなら `git pull --rebase`、他のローカルブランチなら
 * **チェックアウトせずに早送りする** (docs/specs/git-operations.md)。
 * 有効かどうかは `shared/lib/selection.ts` の `canPull` が決める。
 */
export function pullRow(row: RowNode): Promise<CommandResult> {
  if (row.kind === "repo") {
    return perform(row.repoId, () => ipc.pullCurrent(row.repoId));
  }
  if (row.kind === "branch") {
    return row.branch.is_current
      ? perform(row.repoId, () => ipc.pullCurrent(row.repoId))
      : perform(row.repoId, () => ipc.fastForwardBranch(row.repoId, row.branch.name));
  }
  return Promise.resolve(failure("この行はプルできません"));
}

/** チェックアウトする。タグは detached、リモートは Rust 側で分岐する */
export function checkoutRow(row: RowNode): Promise<CommandResult> {
  const target = checkoutTargetOf(row);
  if (target === null) return Promise.resolve(failure("この行はチェックアウトできません"));
  return perform(row.repoId, () =>
    target.tag
      ? ipc.checkoutTag(row.repoId, target.name)
      : ipc.checkoutBranch(row.repoId, target.name),
  );
}

/** チェックアウトしてからプルする。前が失敗したら Rust 側で止まる */
export function checkoutAndPullRow(row: RowNode): Promise<CommandResult> {
  const target = checkoutTargetOf(row);
  if (target === null || target.tag) {
    return Promise.resolve(failure("この行はチェックアウトできません"));
  }
  return perform(row.repoId, () => ipc.checkoutAndPull(row.repoId, target.name));
}

/** detached HEAD から直前のブランチへ戻る */
export function checkoutPreviousBranch(repoId: RepoId): Promise<CommandResult> {
  return perform(repoId, () => ipc.checkoutPrevious(repoId));
}

/**
 * プッシュする。`forceWithLease` はダイアログで見せていた `origin/<名前>` の sha。
 */
export function pushBranch(
  repoId: RepoId,
  branch: string,
  forceWithLease: string | null = null,
): Promise<CommandResult> {
  return perform(repoId, () => ipc.pushBranch(repoId, branch, forceWithLease));
}

export function renameBranch(
  repoId: RepoId,
  name: string,
  newName: string,
): Promise<CommandResult> {
  return perform(repoId, () => ipc.renameBranch(repoId, name, newName));
}

/**
 * プッシュダイアログに出すものを読む。
 *
 * スナップショットには載っていない。載せると取り直すたびに全ローカルブランチ分の
 * `git log` が走る (docs/specs/data-model.md の `Branch`)。
 * 読めなければ `null` を返して、理由を結果として残す。
 */
export async function loadPushPreview(repoId: RepoId, branch: string): Promise<PushPreview | null> {
  try {
    return await ipc.getPushPreview(repoId, branch);
  } catch (error) {
    recordResult(repoId, failure(messageOf(error)));
    return null;
  }
}

/**
 * git を実行しない補助操作。**文言は Rust 側が持つ**
 * (docs/adr/0015-auxiliary-operations.md)。
 */
export async function revealRepository(repoId: RepoId): Promise<void> {
  await runDirect(repoId, () => ipc.revealInFinder(repoId));
}

export async function openRepositoryInTerminal(repoId: RepoId): Promise<void> {
  await runDirect(repoId, () => ipc.openInTerminal(repoId));
}

/**
 * クリップボードへコピーする。IPC を通さないので、**結果の組み立てだけは
 * ここでやる** (docs/adr/0015-auxiliary-operations.md)。
 *
 * **失敗を黙って落とさない。** トーストに出す。
 */
export async function copyToClipboard(repoId: RepoId, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    recordResult(repoId, {
      kind: "direct",
      ok: true,
      steps: [],
      message: `コピーしました: ${text}`,
    });
  } catch (error) {
    recordResult(repoId, failure(messageOf(error)));
  }
}

/** Rust が組み立てた結果をそのまま流す */
async function runDirect(repoId: RepoId, call: () => Promise<CommandResult>): Promise<void> {
  try {
    recordResult(repoId, await call());
  } catch (error) {
    recordResult(repoId, failure(messageOf(error)));
  }
}

/** その行がチェックアウトの対象として持っている名前 */
function checkoutTargetOf(row: RowNode): { readonly name: string; readonly tag: boolean } | null {
  if (row.kind === "branch") return { name: row.branch.name, tag: false };
  if (row.kind === "remote") return { name: row.reference.name, tag: false };
  if (row.kind === "tag") return { name: row.reference.name, tag: true };
  return null;
}
