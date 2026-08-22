import { useToastStore } from "./useToastStore";

/*
 * git の結果ではない失敗の知らせ。
 *
 * `store/results.ts` は `CommandResult` 専用なので、設定の保存やイベントの購読の
 * ように「リポジトリに紐づかない失敗」はここを通す。
 * **握りつぶさない** (AGENTS.md)。出す場所を 1 本にしておかないと、
 * `useToastStore` を直接叩く場所が features ごとに増える。
 */

/** リポジトリに紐づかない失敗。コンソールへの導線は付かない */
export function notifyFailure(text: string): void {
  useToastStore.getState().push({ kind: "failure", text });
}
