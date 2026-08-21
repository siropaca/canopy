/*
 * フロント専用の手書き型。
 * Rust から来る型は generated/ にある (docs/adr/0013-type-generation.md)。
 * ここに generated/ の型を再定義しない。
 */

import type { Branch } from "./generated/Branch";
import type { Ref } from "./generated/Ref";
import type { RepoSnapshot } from "./generated/RepoSnapshot";

export type RepoId = string;

/** リポジトリ 1 件の読み込み状態 (docs/specs/data-model.md の `RepoState`) */
export type RepoStatus = "loading" | "ready" | "error";

/**
 * ストアが持つリポジトリ 1 件分の状態。
 *
 * **取得できた状態しか表現できない形にしない。** 11 リポジトリを並列に読むので、
 * 見出しだけ描ける状態が必ず要る (docs/specs/data-model.md)。
 */
export interface RepoState {
  readonly id: RepoId;
  /** 登録情報から来る。スナップショットが無くても表示できる */
  readonly name: string;
  /** 登録情報から来る絶対パス。表示とコピーのため */
  readonly path: string;
  readonly status: RepoStatus;
  /** `ready` のときだけ入る */
  readonly snapshot: RepoSnapshot | null;
  /** `error` のときだけ入る */
  readonly error: string | null;
  /**
   * このリポジトリに実行中の操作があるか。
   *
   * **正はここ。** 実行中はそのリポジトリの操作系 UI を無効にする
   * (docs/specs/ui.md の「実行中の扱い」)。判定は
   * `shared/lib/selection.ts` の述語を通す。
   */
  readonly running: boolean;
}

/** ツリーの括り。折りたたみキーのスコープでもある */
export type TreeScope = "local" | "remote" | "tag";

interface RowBase {
  /** 選択と折りたたみの鍵。`<リポジトリ id>|<スコープ>|<パス>` */
  readonly key: string;
  /** インデントの段数。`data-depth` に出す */
  readonly depth: number;
  readonly repoId: RepoId;
  /**
   * そのリポジトリに実行中の操作があるか。`RepoState.running` を写したもの。
   *
   * 行に持たせているのは、述語 (`shared/lib/selection.ts`) を行だけで
   * 判定できるようにするため。`dirtyCount` と同じ扱いで、正はストア側。
   */
  readonly running: boolean;
}

/**
 * リポジトリ見出しの行。
 *
 * `repo` はストアが持っているものと同じオブジェクト (平坦化はコピーしない)。
 * **正はストア側。** 行が持っているのは描画を props で完結させるためで、
 * ブランチ行には `repo` が無いので、リポジトリ以外も扱う画面 (詳細ペインなど) は
 * `repoId` からストアを引く。
 */
export interface RepoRow extends RowBase {
  readonly kind: "repo";
  readonly repo: RepoState;
  readonly expanded: boolean;
  /** 検索でヒットがあるか。検索していないときは true */
  readonly matched: boolean;
}

/** `ローカル` / `リモート` / `タグ` の括り行 */
export interface SectionRow extends RowBase {
  readonly kind: "section";
  readonly scope: TreeScope;
  readonly label: string;
  readonly expanded: boolean;
}

/** スラッシュで畳んだディレクトリの行 */
export interface DirectoryRow extends RowBase {
  readonly kind: "directory";
  readonly scope: TreeScope;
  /** 表示する名前 (最終セグメント) */
  readonly label: string;
  readonly expanded: boolean;
}

/** ローカルブランチの行 */
export interface BranchRow extends RowBase {
  readonly kind: "branch";
  readonly branch: Branch;
  /** 表示する名前。グループ化オンなら最終セグメント */
  readonly label: string;
  /** このブランチのワークツリーの未コミット数 */
  readonly dirtyCount: number;
  /** 別のワークツリーにチェックアウトされているときのディレクトリ名 */
  readonly worktreeName: string | null;
}

/** リモート追跡ブランチとタグの行 */
export interface RefRow extends RowBase {
  readonly kind: "remote" | "tag";
  readonly reference: Ref;
  readonly label: string;
}

export type RowNode = RepoRow | SectionRow | DirectoryRow | BranchRow | RefRow;

/** ツリーで選べるもの。詳細ペインとサイドバーの有効条件に使う */
export type SelectableKind = RowNode["kind"];
