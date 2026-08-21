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
  getPushPreview: "get_push_preview",
  revealInFinder: "reveal_in_finder",
  openInTerminal: "open_in_terminal",
} as const;

/**
 * 一括フェッチの結果が 1 件ずつ届くイベント。
 *
 * 11 本の invoke を並列に投げる形にしない。返ってきた順に差し替える
 * (docs/adr/0009-concurrency-and-refresh.md の「一括フェッチ」)。
 */
export const EVENTS = {
  repoSnapshotUpdated: "repo_snapshot_updated",
} as const;
