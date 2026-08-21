import { invoke } from "@tauri-apps/api/core";

import { COMMANDS } from "./commands";
import type { CommandResult } from "./generated/CommandResult";
import type { OpOutcome } from "./generated/OpOutcome";
import type { PushPreview } from "./generated/PushPreview";
import type { RepoId } from "./types";

/*
 * 書き込みと補助操作の薄いラッパ。
 *
 * **引数はリポジトリの id にする。** パスを引数に取るコマンドを作らない
 * (docs/security.md)。引数名は Rust 側の `rename_all = "snake_case"` に合わせる。
 *
 * 戻り値は `{ result, snapshot }` の 1 つ。取り直しのために 2 回目を投げない
 * (docs/adr/0009-concurrency-and-refresh.md)。
 */

export function fetchRepo(repoId: RepoId): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.fetchRepo, { repo_id: repoId });
}

/** 全リポジトリをフェッチする。**結果はイベントで届く** (`ipc/events.ts`) */
export function fetchAll(): Promise<RepoId[]> {
  return invoke<RepoId[]>(COMMANDS.fetchAll);
}

/** 現在のブランチをプルする (`git pull --rebase`) */
export function pullCurrent(repoId: RepoId): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.pullCurrent, { repo_id: repoId });
}

/**
 * 他のローカルブランチを早送りする。**チェックアウトしない。**
 *
 * 現在のブランチのプルとは別物 (docs/specs/git-operations.md)。
 */
export function fastForwardBranch(repoId: RepoId, branch: string): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.fastForwardBranch, { repo_id: repoId, branch });
}

/** ブランチに切り替える。リモート追跡の名前も渡せる (分岐は Rust 側) */
export function checkoutBranch(repoId: RepoId, name: string): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.checkoutBranch, { repo_id: repoId, name });
}

export function checkoutTag(repoId: RepoId, tag: string): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.checkoutTag, { repo_id: repoId, tag });
}

export function checkoutAndPull(repoId: RepoId, name: string): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.checkoutAndPull, { repo_id: repoId, name });
}

/** detached HEAD から直前のブランチへ戻る */
export function checkoutPrevious(repoId: RepoId): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.checkoutPrevious, { repo_id: repoId });
}

/**
 * プッシュする。`forceWithLease` に sha を渡すと強制プッシュ。
 *
 * **sha はダイアログを開いた時点で見せていた `origin/<名前>` のもの。**
 * 値なしの `--force-with-lease` はフェッチした直後に無意味になる
 * (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)。
 */
export function pushBranch(
  repoId: RepoId,
  branch: string,
  forceWithLease: string | null = null,
): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.pushBranch, {
    repo_id: repoId,
    branch,
    force_with_lease: forceWithLease,
  });
}

export function renameBranch(repoId: RepoId, name: string, newName: string): Promise<OpOutcome> {
  return invoke<OpOutcome>(COMMANDS.renameBranch, {
    repo_id: repoId,
    name,
    new_name: newName,
  });
}

/** プッシュダイアログに出すもの。スナップショットには載っていない */
export function getPushPreview(repoId: RepoId, branch: string): Promise<PushPreview> {
  return invoke<PushPreview>(COMMANDS.getPushPreview, { repo_id: repoId, branch });
}

/**
 * Finder で表示する。git を実行しないが、**結果の形は他の操作と揃っている。**
 * 文言は Rust 側が持つ (docs/adr/0015-auxiliary-operations.md)。
 */
export function revealInFinder(repoId: RepoId): Promise<CommandResult> {
  return invoke<CommandResult>(COMMANDS.revealInFinder, { repo_id: repoId });
}

export function openInTerminal(repoId: RepoId): Promise<CommandResult> {
  return invoke<CommandResult>(COMMANDS.openInTerminal, { repo_id: repoId });
}
