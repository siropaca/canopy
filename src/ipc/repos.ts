import { invoke } from "@tauri-apps/api/core";

import { COMMANDS } from "./commands";
import type { AddRepoOutcome } from "./generated/AddRepoOutcome";
import type { RepoRegistration } from "./generated/RepoRegistration";
import type { RepoSnapshot } from "./generated/RepoSnapshot";
import type { UiState } from "./generated/UiState";
import type { RepoId } from "./types";

/*
 * Tauri コマンドの薄いラッパ。
 *
 * **引数はリポジトリの id にする。** パスを引数に取るコマンドを作らない
 * (docs/security.md)。
 * 引数名は Rust 側の `rename_all = "snake_case"` に合わせる。
 */

/** 登録済みのリポジトリ。並び順のとおり */
export function listRepos(): Promise<RepoRegistration[]> {
  return invoke<RepoRegistration[]>(COMMANDS.listRepos);
}

export function getUiState(): Promise<UiState> {
  return invoke<UiState>(COMMANDS.getUiState);
}

/** UI 状態をまとめて保存する。**並び順もこれで保存する** */
export function saveUiState(uiState: UiState): Promise<void> {
  return invoke<void>(COMMANDS.saveUiState, { ui_state: uiState });
}

/** フォルダ選択を Rust 側で開いて登録する */
export function addRepo(): Promise<AddRepoOutcome> {
  return invoke<AddRepoOutcome>(COMMANDS.addRepo);
}

export function removeRepo(repoId: RepoId): Promise<void> {
  return invoke<void>(COMMANDS.removeRepo, { repo_id: repoId });
}

export function getRepoSnapshot(repoId: RepoId): Promise<RepoSnapshot> {
  return invoke<RepoSnapshot>(COMMANDS.getRepoSnapshot, { repo_id: repoId });
}
