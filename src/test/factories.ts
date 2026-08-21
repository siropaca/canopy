/*
 * テスト用のデータ作り。
 * 実装が読む形と 1:1 にして、テストごとに必要な項目だけ上書きする。
 */

import type { Branch } from "@/ipc/generated/Branch";
import type { Change } from "@/ipc/generated/Change";
import type { ChangeList } from "@/ipc/generated/ChangeList";
import type { Ref } from "@/ipc/generated/Ref";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { Worktree } from "@/ipc/generated/Worktree";
import type { RepoState } from "@/ipc/types";

/** 2026-08-01 10:00:00 JST */
export const SOME_TIME = 1_785_286_800_000;

export function makeBranch(name: string, overrides: Partial<Branch> = {}): Branch {
  return {
    name,
    is_current: false,
    behind: 0,
    ahead: 0,
    upstream: `origin/${name}`,
    upstream_gone: false,
    committed_at: SOME_TIME,
    worktree_path: null,
    ...overrides,
  };
}

export function makeRef(name: string, overrides: Partial<Ref> = {}): Ref {
  return { name, committed_at: SOME_TIME, ...overrides };
}

export function makeChanges(paths: readonly string[], total?: number): ChangeList {
  const items: Change[] = paths.map((path) => ({ status: "M", path }));
  return { items, total: total ?? paths.length };
}

export function makeWorktree(
  branch: string,
  path: string,
  overrides: Partial<Worktree> = {},
): Worktree {
  return { branch, path, changes: makeChanges([]), ...overrides };
}

export function makeSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    id: "r1",
    name: "acme-api",
    path: "/repos/acme-api",
    origin_url: "https://github.com/acme/acme-api",
    local: [],
    remote: [],
    tags: [],
    worktrees: [],
    changes: makeChanges([]),
    fetched_at: null,
    revision: 1,
    head: { kind: "branch", name: "main" },
    ...overrides,
  };
}

/** 読み込みが終わったリポジトリ */
export function makeRepo(id: string, snapshot?: Partial<RepoSnapshot>): RepoState {
  const built = makeSnapshot({ id, ...snapshot });
  return {
    id,
    name: built.name,
    path: built.path,
    status: "ready",
    snapshot: built,
    error: null,
  };
}

/** まだ読み込み中のリポジトリ */
export function makeLoadingRepo(id: string, name = "loading-repo"): RepoState {
  return { id, name, path: `/repos/${name}`, status: "loading", snapshot: null, error: null };
}

/** 取得に失敗したリポジトリ */
export function makeErrorRepo(id: string, error: string, name = "broken-repo"): RepoState {
  return { id, name, path: `/repos/${name}`, status: "error", snapshot: null, error };
}
