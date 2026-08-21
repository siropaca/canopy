import type { BranchRow, RefRow, RepoRow, RepoState, RowNode } from "@/ipc/types";
import {
  canCheckout,
  canCheckoutAndPull,
  canCheckoutPrevious,
  canFetch,
  canPull,
  canPush,
  canRemoveRepo,
  canRename,
} from "@/shared/lib/selection";

/*
 * 行の種類からコンテキストメニューの項目を決める。
 *
 * 並びと文言は docs/specs/ui.md の「コンテキストメニュー」。
 * 各項目が実行する git は docs/specs/git-operations.md。
 *
 * **v2 の項目はグレーで置く。押しても何も起きない。**
 * v1 の項目でも、必ず失敗する条件のときは同じように無効にする
 * (`gone` のプル、`⧉` のチェックアウト)。判定は `shared/lib/selection.ts`。
 */

/** メニューから起こす操作 */
export type MenuAction =
  | { readonly type: "pull" }
  | { readonly type: "push" }
  | { readonly type: "checkout" }
  | { readonly type: "checkoutAndPull" }
  | { readonly type: "rename" }
  | { readonly type: "fetchRepo" }
  | { readonly type: "fetchAll" }
  | { readonly type: "checkoutPrevious" }
  | { readonly type: "reveal" }
  | { readonly type: "terminal" }
  | { readonly type: "addRepo" }
  | { readonly type: "removeRepo" }
  | { readonly type: "copy"; readonly text: string };

export type MenuItem =
  | {
      readonly kind: "action";
      readonly label: string;
      readonly action: MenuAction;
      readonly disabled: boolean;
      /** 項目名の右に薄く出す実際の値 (コピーのサブメニュー) */
      readonly value?: string;
    }
  /** v2 の項目。押しても何も起きない */
  | { readonly kind: "v2"; readonly label: string }
  | { readonly kind: "separator" }
  | { readonly kind: "title"; readonly label: string }
  | { readonly kind: "submenu"; readonly label: string; readonly items: readonly MenuItem[] };

const SEPARATOR: MenuItem = { kind: "separator" };

/** 実行できる項目 */
function action(label: string, act: MenuAction, disabled = false): MenuItem {
  return { kind: "action", label, action: act, disabled };
}

function v2(label: string): MenuItem {
  return { kind: "v2", label };
}

/** メニューに出す項目。括りとディレクトリでは呼ばない (`hasMenu` で弾く) */
export function menuItemsFor(row: RowNode, repo: RepoState): MenuItem[] {
  switch (row.kind) {
    case "repo":
      return repositoryItems(row, repo);
    case "branch":
      return row.branch.is_current ? currentBranchItems(row) : otherBranchItems(row, repo);
    case "remote":
      return remoteItems(row, repo);
    case "tag":
      return tagItems(row);
    default:
      return [];
  }
}

function repositoryItems(row: RepoRow, repo: RepoState): MenuItem[] {
  const items: MenuItem[] = [
    action("このリポジトリをフェッチ", { type: "fetchRepo" }, !canFetch(row)),
    action("プル", { type: "pull" }, !canPull(row)),
  ];
  // detached HEAD のときだけ出す。これが無いとタグを開いた時点で戻れない
  if (canCheckoutPrevious(row) || repo.snapshot?.head.kind === "detached") {
    items.push(
      action("直前のブランチに戻る", { type: "checkoutPrevious" }, !canCheckoutPrevious(row)),
    );
  }
  items.push(
    SEPARATOR,
    action("すべてフェッチ", { type: "fetchAll" }),
    SEPARATOR,
    { kind: "submenu", label: "パス/参照のコピー", items: copyItems(repo) },
    SEPARATOR,
    action("Finder で表示", { type: "reveal" }),
    action("ターミナルで開く", { type: "terminal" }),
    SEPARATOR,
    action("リポジトリを追加", { type: "addRepo" }),
    action("リストから削除", { type: "removeRepo" }, !canRemoveRepo(row)),
  );
  return items;
}

/** 項目名の右に実際の値を薄く出す。**サブメニューだけ** (docs/specs/ui.md) */
function copyItems(repo: RepoState): MenuItem[] {
  const items: MenuItem[] = [
    { kind: "title", label: "コピー" },
    withValue(asCopy("絶対パス", repo.path), repo.path),
    withValue(asCopy("リポジトリ名", repo.name), repo.name),
  ];
  const url = repo.snapshot?.origin_url ?? null;
  if (url !== null) {
    items.push(SEPARATOR, withValue(asCopy("GitHub リポジトリ URL", url), url));
  }
  return items;
}

function asCopy(label: string, text: string): MenuItem {
  return { kind: "action", label, action: { type: "copy", text }, disabled: false };
}

function withValue(item: MenuItem, value: string): MenuItem {
  return item.kind === "action" ? { ...item, value } : item;
}

function currentBranchItems(row: BranchRow): MenuItem[] {
  const name = row.branch.name;
  const upstream = row.branch.upstream ?? `origin/${name}`;
  return [
    action("プル", { type: "pull" }, !canPull(row)),
    action("プッシュ", { type: "push" }, !canPush(row)),
    SEPARATOR,
    v2(`${upstream} でリベース`),
    SEPARATOR,
    asCopy("ブランチ名をコピー", name),
    action("名前の変更", { type: "rename" }, !canRename(row)),
    SEPARATOR,
    v2("新規ブランチ"),
    v2("作業ツリーとの差分を表示"),
  ];
}

function otherBranchItems(row: BranchRow, repo: RepoState): MenuItem[] {
  const name = row.branch.name;
  const current = currentName(repo);
  return [
    action("チェックアウト", { type: "checkout" }, !canCheckout(row)),
    action("チェックアウトとプル", { type: "checkoutAndPull" }, !canCheckoutAndPull(row)),
    v2(`${quote(name)} から新規ブランチ`),
    SEPARATOR,
    v2(`${quote(name)} で ${quote(current)} をリベース`),
    v2(`${quote(name)} を ${quote(current)} にマージ`),
    SEPARATOR,
    action("プル", { type: "pull" }, !canPull(row)),
    action("プッシュ", { type: "push" }, !canPush(row)),
    SEPARATOR,
    asCopy("ブランチ名をコピー", name),
    action("名前の変更", { type: "rename" }, !canRename(row)),
    SEPARATOR,
    v2("削除"),
  ];
}

function remoteItems(row: RefRow, repo: RepoState): MenuItem[] {
  const name = row.reference.name;
  const current = currentName(repo);
  return [
    action("チェックアウト", { type: "checkout" }, !canCheckout(row)),
    v2(`${quote(name)} から新規ブランチ`),
    SEPARATOR,
    v2(`${quote(name)} で ${quote(current)} をリベース`),
    v2(`${quote(name)} を ${quote(current)} にマージ`),
    SEPARATOR,
    asCopy("ブランチ名をコピー", name),
    SEPARATOR,
    v2("削除"),
  ];
}

function tagItems(row: RefRow): MenuItem[] {
  const name = row.reference.name;
  return [
    action("チェックアウト", { type: "checkout" }, !canCheckout(row)),
    v2(`${quote(name)} から新規ブランチ`),
    SEPARATOR,
    asCopy("タグ名をコピー", name),
    SEPARATOR,
    v2("削除"),
  ];
}

/** 現在のブランチ名。detached なら参照名 */
function currentName(repo: RepoState): string {
  return repo.snapshot?.head.name ?? "";
}

function quote(name: string): string {
  return `'${name}'`;
}
