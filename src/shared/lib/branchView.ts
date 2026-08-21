import type { Branch } from "@/ipc/generated/Branch";
import type { ChangeList } from "@/ipc/generated/ChangeList";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";

/*
 * ブランチと「そのブランチのワークツリー」を結び直す。
 *
 * 未コミットはワークツリー単位で持っている (docs/specs/data-model.md)。
 * ツリーの `●n` と詳細ペインのファイル一覧はどちらもこれを通す。
 */

/**
 * そのブランチのワークツリーの未コミット変更。
 *
 * - 登録したワークツリーの現在ブランチなら、そのリポジトリの変更
 * - 別のワークツリーにチェックアウトされていれば、そのワークツリーの変更
 * - どちらでもなければ変更を持たない
 */
export function changesForBranch(snapshot: RepoSnapshot, branch: Branch): ChangeList | null {
  if (branch.is_current) return snapshot.changes;
  if (branch.worktree_path === null) return null;
  return (
    snapshot.worktrees.find((worktree) => worktree.path === branch.worktree_path)?.changes ?? null
  );
}

/** ワークツリーの表示名。パスの末尾のディレクトリ名 */
export function worktreeName(path: string | null): string | null {
  if (path === null) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.at(-1) ?? path;
}
