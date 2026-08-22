import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { RepoId } from "@/ipc/types";
import { consoleBlocks } from "@/shared/lib/consoleLog";

import { isConsoleShowing } from "./consoleActions";
import { bulkFetchSettled, bulkFetchSummary, useBulkFetchStore } from "./useBulkFetchStore";
import { useConsoleStore } from "./useConsoleStore";
import { useRepoStore } from "./useRepoStore";
import { useToastStore } from "./useToastStore";

/*
 * 結果の出し先。
 *
 * **コンソールとトーストへ流す場所はここ 1 本。** 操作ごとに書くと、
 * どれか 1 つだけコンソールに出ない、という壊れ方をする。
 *
 * 出し分けは `CommandResult.kind` で決める (docs/adr/0018-command-result-steps.md)。
 * **`steps.length === 0` で「git を実行しなかった」を判定しない。**
 * 省略・コピー・アプリ側の異常が全部 0 段になる。
 */

/** 個別の操作の結果 */
export function recordResult(repoId: RepoId, result: CommandResult): void {
  const logged = appendToConsole(repoId, result);
  showToast(repoId, result, logged);
}

/**
 * 一括フェッチの 1 件ぶん (`repo_snapshot_updated`)。
 *
 * **リポジトリごとにトーストを出さない。** 11 件出すと上限 6 を超えて
 * 失敗のトーストが押し出される (docs/specs/ui.md の「トースト」)。
 * 対象でなければ個別の結果として扱う。捨てると結果がどこにも出ない。
 */
export function recordBulkResult(repoId: RepoId, result: CommandResult): void {
  const logged = appendToConsole(repoId, result);
  if (!useBulkFetchStore.getState().note(repoId, result.ok)) {
    showToast(repoId, result, logged);
    return;
  }
  settleBulkFetch();
}

/** 一括フェッチを始める。**投げる前に呼ぶ。** 結果の方が先に届く */
export function startBulkFetch(ids: readonly RepoId[]): void {
  useBulkFetchStore.getState().start(ids);
}

/** 実際に走った一覧に合わせる。減った結果そろっていれば、その時点で集約する */
export function retargetBulkFetch(ids: readonly RepoId[]): void {
  useBulkFetchStore.getState().retarget(ids);
  settleBulkFetch();
}

/** 投げられなかった。集約せずに畳む (トーストは呼び出し側が出す) */
export function cancelBulkFetch(): void {
  useBulkFetchStore.getState().reset();
}

/** 全件そろっていれば 1 件にまとめて出して、次の一括フェッチに備える */
function settleBulkFetch(): void {
  const bulk = useBulkFetchStore.getState();
  if (!bulkFetchSettled(bulk)) return;
  useToastStore.getState().push({ kind: "success", text: bulkFetchSummary(bulk) });
  bulk.reset();
}

/** コンソールに積む。段が無ければ何もしない。積んだかどうかを返す */
function appendToConsole(repoId: RepoId, result: CommandResult): boolean {
  const blocks = consoleBlocks(result, { at: new Date() });
  if (blocks.length === 0) return false;
  // 見えているタブに赤いドットを立てない。判定は `store/consoleActions.ts` の 1 本
  useConsoleStore
    .getState()
    .append(repoId, blocks, { failed: !result.ok && !isConsoleShowing(repoId) });
  return true;
}

/**
 * トーストを 1 件出す。
 *
 * **`ok` だけで色を決めない。** 省略 (`skipped`) は `ok` が false だが
 * 失敗ではないので赤くしない (docs/adr/0018-command-result-steps.md)。
 */
function showToast(repoId: RepoId, result: CommandResult, logged: boolean): void {
  const repoName = useRepoStore.getState().byId.get(repoId)?.name;
  const failed = !result.ok && result.kind !== "skipped";
  const commands = result.steps.map((step) => step.command).join(" && ");
  // 成功したときは実行したコマンドを出す。伝えるべき文言があればそちらを優先する
  const text = result.message ?? (failed ? "失敗しました" : commands);

  useToastStore.getState().push({
    kind: failed ? "failure" : "success",
    text,
    repoName,
    command: !failed && result.message === null && commands !== "",
    // **コンソールに出す段があるときだけ導線を出す。** 空のタブへ飛ばさない
    detailRepoId: failed && logged ? repoId : undefined,
  });
}
