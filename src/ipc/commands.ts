/**
 * Rust 側に登録してあるコマンドの名前と、購読するイベントの名前。
 *
 * ラッパは手書きなので、名前と引数名の間違いは型では防げない
 * (docs/adr/0013-type-generation.md)。
 * ここを 1 箇所にして、`commands.test.ts` が `src-tauri/src/` と突き合わせる。
 */
export const COMMANDS = {
  // 設定 (commands/settings.rs)
  listRepos: "list_repos",
  getUiState: "get_ui_state",
  saveUiState: "save_ui_state",
  addRepo: "add_repo",
  removeRepo: "remove_repo",
  // 読み取り (commands/snapshot.rs)
  getRepoSnapshot: "get_repo_snapshot",
  // 書き込みと補助操作 (commands/ops.rs)
  fetchRepo: "fetch_repo",
  fetchAll: "fetch_all",
  pullCurrent: "pull_current",
  fastForwardBranch: "fast_forward_branch",
  checkoutBranch: "checkout_branch",
  checkoutTag: "checkout_tag",
  checkoutAndPull: "checkout_and_pull",
  checkoutPrevious: "checkout_previous",
  pushBranch: "push_branch",
  renameBranch: "rename_branch",
  deleteBranch: "delete_branch",
  getPushPreview: "get_push_preview",
  revealInFinder: "reveal_in_finder",
  openInTerminal: "open_in_terminal",
} as const;

/**
 * Rust から届くイベント。
 *
 * - `repo_snapshot_updated`: 一括フェッチの結果が 1 件ずつ届く。11 本の invoke を
 *   並列に投げる形にしない ([ADR-0009](../../docs/adr/0009-concurrency-and-refresh.md))
 * - `repos_changed`: `.git` が変わったリポジトリがまとめて届く
 *   ([ADR-0022](../../docs/adr/0022-auto-refresh.md))
 */
export const EVENTS = {
  repoSnapshotUpdated: "repo_snapshot_updated",
  reposChanged: "repos_changed",
} as const;
