/**
 * Rust 側に登録してあるコマンドの名前。
 *
 * ラッパは手書きなので、名前と引数名の間違いは型では防げない
 * (docs/adr/0013-type-generation.md)。
 * ここを 1 箇所にして、`commands.test.ts` が `src-tauri/src/lib.rs` と突き合わせる。
 */
export const COMMANDS = {
  listRepos: "list_repos",
  getUiState: "get_ui_state",
  saveUiState: "save_ui_state",
  addRepo: "add_repo",
  removeRepo: "remove_repo",
  getRepoSnapshot: "get_repo_snapshot",
} as const;
