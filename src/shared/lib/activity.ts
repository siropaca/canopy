import type { RepoId } from "@/ipc/types";

/*
 * ステータスバーに出す「いま何をしているか」
 * (docs/adr/0023-progress-in-the-status-bar.md)。
 *
 * **無効化と行の薄さだけでは足りない。** ツリーは畳めるしスクロールするので、
 * 対象の行が見えていないと押した操作が効いたのかが分からない。
 * 場所の決まったところに 1 行だけ出す。
 *
 * **組み立てはここ 1 本。** 表示側で分岐を書くと、状態を足したときに
 * 片方だけ古くなる。
 */

/** ステータスバーに名前を出す操作 */
export type Activity =
  "fetch" | "pull" | "checkout" | "checkoutAndPull" | "push" | "rename" | "delete";

/**
 * 操作の呼び名。
 *
 * **`Record` にして網羅を型で縛る。** 操作を足したときに、ここを埋めないと
 * コンパイルが通らない。
 */
const VERBS: Record<Activity, string> = {
  fetch: "フェッチ",
  pull: "プル",
  checkout: "チェックアウト",
  checkoutAndPull: "チェックアウトとプル",
  push: "プッシュ",
  rename: "名前の変更",
  delete: "削除",
};

export interface ActivityInput {
  /** リポジトリごとの、走っている書き込みの列 */
  readonly running: ReadonlyMap<RepoId, readonly Activity[]>;
  /** 取り直しの最中のリポジトリ */
  readonly reading: ReadonlySet<RepoId>;
  /** 一括フェッチの進み具合。走っていなければ `null` */
  readonly bulk: { readonly total: number; readonly done: number } | null;
  readonly nameOf: (repoId: RepoId) => string | undefined;
}

/**
 * いま出す 1 行。何も走っていなければ `null`。
 *
 * 優先順位は 一括フェッチ → 書き込み → 取り直し。
 * **書き込みを取り直しより先に出す。** 無効化に対応するのは書き込みだけなので、
 * ボタンが灰色な理由を隠さない。
 */
export function activityLabel(input: ActivityInput): string | null {
  if (input.bulk !== null) return `フェッチ ${input.bulk.done} / ${input.bulk.total}`;

  const writes = [...input.running].flatMap(([repoId, kinds]) =>
    kinds.map((kind) => ({ repoId, kind })),
  );
  if (writes.length === 1) {
    const [only] = writes;
    // 走っている 1 本は必ず取れる (長さで分岐している)
    if (only !== undefined) {
      const name = input.nameOf(only.repoId);
      if (name !== undefined) return `${name} を${VERBS[only.kind]}中`;
    }
  }
  if (writes.length > 0) return `${writes.length} 件を実行中`;

  const reads = [...input.reading];
  if (reads.length === 1) {
    const [only] = reads;
    if (only !== undefined) {
      const name = input.nameOf(only);
      if (name !== undefined) return `${name} を更新中`;
    }
  }
  if (reads.length > 0) return `${reads.length} リポジトリを更新中`;

  return null;
}
