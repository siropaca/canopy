import type { Branch } from "@/ipc/generated/Branch";
import type { RowNode } from "@/ipc/types";

/*
 * 行に対する述語。
 *
 * 「有効になる条件」は docs/specs/ui.md の表。判定は React に依存しない形でここに置く。
 * **サイドバー・コンテキストメニュー・詳細ペインの 3 features が同じ入力から
 * 判断する** ので、features のコンポーネントには置かない (features 同士は参照できない)。
 *
 * 有効条件は「選択の種類」ではなく「**画面に見えている**選択の種類」なので、
 * 渡すのは平坦化した行 (見えていない選択は null になる)。
 *
 * 実行中のリポジトリは操作系すべてを無効にする (docs/specs/ui.md の「実行中の扱い」)。
 * 折りたたみとメニューの表示自体は止めない。
 */

/** 折りたためる行か。ダブルクリックの振る舞いが分かれる */
export function isFoldable(row: RowNode): boolean {
  return row.kind === "repo" || row.kind === "section" || row.kind === "directory";
}

/**
 * コンテキストメニューを出す行か。
 *
 * `ローカル` / `リモート` / `タグ` の括りとディレクトリでは出さない (選択だけ)。
 */
export function hasMenu(row: RowNode): boolean {
  return row.kind !== "section" && row.kind !== "directory";
}

/**
 * 「プル」を有効にできるか。
 *
 * - リポジトリ: 現在ブランチが要る。**detached HEAD では無効** (docs/specs/ui.md)
 * - ローカルブランチ: 追跡先が要る。消えている (`gone`) と必ず
 *   `couldn't find remote ref` で失敗し、未設定だと追跡情報が無いと言われる
 * - `⧉` が付いたブランチは有効。**そのワークツリーで実行する** (分岐は Rust 側)
 * - それ以外 (括り・ディレクトリ・リモート・タグ): 無効
 */
export function canPull(row: RowNode | null): boolean {
  if (row === null || row.running) return false;
  if (row.kind === "repo") {
    const snapshot = row.repo.snapshot;
    if (snapshot === null || snapshot.head.kind !== "branch") return false;
    const current = snapshot.local.find((branch) => branch.is_current);
    return current !== undefined && hasUpstream(current);
  }
  if (row.kind === "branch") return hasUpstream(row.branch);
  return false;
}

/**
 * 「チェックアウト」を有効にできるか。
 *
 * `⧉` が付いたブランチは無効。git が同じブランチの二重チェックアウトを拒むので、
 * **必ず `already used by worktree at` で失敗する** (docs/specs/ui.md)。
 */
export function canCheckout(row: RowNode | null): boolean {
  if (row === null || row.running) return false;
  if (row.kind === "branch") return !row.branch.is_current && row.worktreeName === null;
  return row.kind === "remote" || row.kind === "tag";
}

/**
 * 「フェッチ」を有効にできるか。
 *
 * リポジトリを選んでいなければ全リポジトリが対象。
 * git を実行するので、実行中のリポジトリを選んでいると無効。
 *
 * **一括フェッチの最中は、全リポジトリが対象のフェッチを無効にする**
 * (docs/specs/ui.md の「トースト」)。押せると同じ操作が積まれて、
 * 集約したトーストの件数が実際と合わなくなる。
 */
export function canFetch(row: RowNode | null, bulkFetchRunning = false): boolean {
  if (row === null) return !bulkFetchRunning;
  return !row.running;
}

/** 「チェックアウトとプル」を有効にできるか。両方できるときだけ */
export function canCheckoutAndPull(row: RowNode | null): boolean {
  return canCheckout(row) && canPull(row);
}

/**
 * 「リストから削除」を有効にできるか。
 *
 * **実行中は無効。** 実行中に消すと、走っている操作の結果を捨てる先が無くなり、
 * 失敗しても画面のどこにも出ない (docs/specs/ui.md の「実行中の扱い」)。
 * 実行中は 30 秒で必ず解けるので、消せなくなることはない。
 */
export function canRemoveRepo(row: RowNode | null): boolean {
  return row !== null && !row.running && row.kind === "repo";
}

/** 「プッシュ」を有効にできるか。ローカルブランチだけ */
export function canPush(row: RowNode | null): boolean {
  return row !== null && !row.running && row.kind === "branch";
}

/** 「名前の変更」を有効にできるか。ローカルブランチだけ */
export function canRename(row: RowNode | null): boolean {
  return row !== null && !row.running && row.kind === "branch";
}

/**
 * 強制プッシュのチェックボックスを有効にできるか。
 *
 * **ahead が 0 のときは無効。** behind だけのブランチに撃つとリモートを
 * 巻き戻して、他人のコミットを消す (docs/pitfalls.md)。
 */
export function canForcePush(branch: Branch): boolean {
  return branch.ahead > 0;
}

/**
 * 「直前のブランチに戻る」を出すか。
 *
 * detached HEAD のリポジトリ見出しだけ。これが無いとタグをダブルクリックした
 * 時点で戻れなくなる (docs/specs/ui.md の「detached HEAD」)。
 */
export function canCheckoutPrevious(row: RowNode | null): boolean {
  if (row === null || row.running || row.kind !== "repo") return false;
  return row.repo.snapshot?.head.kind === "detached";
}

/** 追跡先があって、消えていないか */
function hasUpstream(branch: Branch): boolean {
  return branch.upstream !== null && !branch.upstream_gone;
}
