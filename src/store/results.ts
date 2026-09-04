import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { RepoId } from "@/ipc/types";
import { consoleBlocks } from "@/shared/lib/consoleLog";

import { isConsoleShowing } from "./consoleActions";
import {
  bulkFetchRunning,
  bulkFetchSettled,
  bulkFetchSummary,
  useBulkFetchStore,
} from "./useBulkFetchStore";
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
    // **畳んだ分は個別のトーストを出さない。** 11 件遅れて届くと上限 6 を超えて、
    // 直前に出した集約のトーストごと押し出される (docs/specs/ui.md の「トースト」)。
    // コンソールには残っているので `詳細を見る` の代わりにそちらで追える
    if (!abandoned.has(repoId)) showToast(repoId, result, logged);
    return;
  }
  settleBulkFetch();
}

/**
 * 結果が届かなくなってから畳むまでの猶予。
 *
 * **1 件届くたびに数え直す。** リポジトリの数で伸びる待ち時間とは切り離す。
 *
 * 値は「1 本のフェッチが正しく待たされる最長」に合わせる。フェッチは同じ
 * リポジトリの書き込みロックを待つので、プルやチェックアウトの後ろに付くと
 * **その 600 秒 + 自分の 30 秒**まで正しく無音になる
 * (docs/adr/0009-concurrency-and-refresh.md の「同時実行の上限」と
 * `src-tauri/src/op_kind.rs` の締め切り)。
 * 短くすると、まだ走っているフェッチを「届かない」と誤って報告する。
 */
export const BULK_FETCH_IDLE_LIMIT_MS = 630_000;

/**
 * 結果を待っている間だけ動く見張り。
 *
 * **1 件でも届かないと、実行中の印とボタンの無効が戻らない。**
 * イベントは全リポジトリぶん飛ぶ前提だが、購読が切れると前提が崩れる
 * (docs/plans/phase-4-polish.md)。
 */
let watchdog: ReturnType<typeof setTimeout> | null = null;

function armWatchdog(): void {
  clearWatchdog();
  watchdog = setTimeout(abandonBulkFetch, BULK_FETCH_IDLE_LIMIT_MS);
}

function clearWatchdog(): void {
  if (watchdog === null) return;
  clearTimeout(watchdog);
  watchdog = null;
}

/** 一括フェッチを始める。**投げる前に呼ぶ。** 結果の方が先に届く */
export function startBulkFetch(ids: readonly RepoId[]): void {
  useBulkFetchStore.getState().start(ids);
  // 前回の畳み残しを持ち越さない
  abandoned.clear();
  armWatchdog();
}

/** 実際に走った一覧に合わせる。減った結果そろっていれば、その時点で集約する */
export function retargetBulkFetch(ids: readonly RepoId[]): void {
  useBulkFetchStore.getState().retarget(ids);
  settleBulkFetch();
}

/** 投げられなかった。集約せずに畳む (トーストは呼び出し側が出す) */
export function cancelBulkFetch(): void {
  useBulkFetchStore.getState().reset();
  clearWatchdog();
}

/** 全件そろっていれば 1 件にまとめて出して、次の一括フェッチに備える */
function settleBulkFetch(): void {
  const bulk = useBulkFetchStore.getState();
  if (!bulkFetchSettled(bulk)) {
    // まだ待っている。次の 1 件までの猶予を数え直す
    if (bulkFetchRunning(bulk)) armWatchdog();
    return;
  }
  clearWatchdog();
  useToastStore.getState().push({ kind: "success", text: bulkFetchSummary(bulk) });
  bulk.reset();
}

/**
 * 畳んだあとに遅れて届くリポジトリ。
 *
 * **実行中の印を二重に外さない。** 畳んだ時点で 1 本外しているので、
 * あとから同じ id のイベントが届いたときにもう一度外すと、その時点で
 * **別の操作が握っている 1 本**を消してしまう (docs/specs/ui.md の「実行中の扱い」)。
 */
const abandoned = new Set<RepoId>();

/**
 * 畳んだ分の結果が遅れて届いたか。届いていたら覚えを外す。
 *
 * 呼ぶのは `store/events.ts` の 1 箇所。
 */
export function wasAbandoned(repoId: RepoId): boolean {
  return abandoned.delete(repoId);
}

/**
 * 猶予を過ぎても届かない分を諦める。
 *
 * **実行中の印を外す。** 外さないと、そのリポジトリの操作系が再起動まで
 * 無効のままになる (docs/specs/ui.md の「実行中の扱い」)。
 * 何件届かなかったかはトーストに出す。**黙って畳まない。**
 */
function abandonBulkFetch(): void {
  watchdog = null;
  const bulk = useBulkFetchStore.getState();
  if (!bulkFetchRunning(bulk)) return;
  const repos = useRepoStore.getState();
  for (const repoId of bulk.targets) {
    if (bulk.done.has(repoId)) continue;
    repos.endRun(repoId, "fetch");
    abandoned.add(repoId);
  }
  useToastStore.getState().push({ kind: "failure", text: bulkFetchSummary(bulk) });
  bulk.reset();
}

/** コンソールに積む。段が無ければ何もしない。積んだかどうかを返す */
function appendToConsole(repoId: RepoId, result: CommandResult): boolean {
  const blocks = consoleBlocks(result, { at: new Date() });
  if (blocks.length === 0) return false;
  // **リストから消したリポジトリのタブを作り直さない。** 一括フェッチの最中に
  // 消すと、あとから届いた結果で名前の引けないタブが復活する
  // (docs/specs/ui.md の「コンソール」)
  if (!useRepoStore.getState().byId.has(repoId)) return false;
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
