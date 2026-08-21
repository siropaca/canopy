import { describe, expect, it } from "vitest";

import {
  makeBranch,
  makeChanges,
  makeErrorRepo,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeSnapshot,
  makeWorktree,
} from "@/test/factories";

import { repoTotals, summarize } from "./totals";

describe("repoTotals", () => {
  it("behind と ahead はブランチ数ではなく合計 (docs/specs/ui.md)", () => {
    const snapshot = makeSnapshot({
      local: [
        makeBranch("main", { behind: 9 }),
        makeBranch("develop", { behind: 7, ahead: 2 }),
        makeBranch("feature/x", { ahead: 1 }),
      ],
      remote: [makeRef("origin/main"), makeRef("origin/develop")],
    });

    expect(repoTotals(snapshot)).toEqual({
      local: 3,
      remote: 2,
      behind: 16,
      ahead: 3,
      dirty: 0,
      worktrees: 0,
    });
  });

  it("未コミットはメインのワークツリーの分だけ数える", () => {
    const snapshot = makeSnapshot({
      changes: makeChanges(["a.ts"]),
      worktrees: [makeWorktree("dev/x", "/wt/x", { changes: makeChanges(["b.ts", "c.ts"]) })],
    });

    const totals = repoTotals(snapshot);

    expect(totals.dirty).toBe(1);
    expect(totals.worktrees).toBe(1);
  });

  it("未コミットの数は `total`。一覧の件数ではない", () => {
    const snapshot = makeSnapshot({ changes: makeChanges(["a.ts"], 1200) });

    expect(repoTotals(snapshot).dirty).toBe(1200);
  });
});

describe("summarize", () => {
  it("全リポジトリの合計とリポジトリ数を出す", () => {
    const repos = [
      makeRepo("r1", {
        local: [makeBranch("main", { behind: 3 })],
        remote: [makeRef("origin/main")],
        changes: makeChanges(["a.ts"]),
      }),
      makeRepo("r2", {
        local: [makeBranch("main", { ahead: 2 }), makeBranch("develop")],
        worktrees: [makeWorktree("develop", "/wt/d")],
      }),
    ];

    expect(summarize(repos)).toEqual({
      repos: 2,
      local: 3,
      remote: 1,
      behind: 3,
      behindRepos: 1,
      ahead: 2,
      aheadRepos: 1,
      dirtyRepos: 1,
      worktrees: 1,
    });
  });

  it("読み込み中が 1 件でもあれば null。数字を 2 回跳ねさせない", () => {
    const repos = [makeRepo("r1"), makeLoadingRepo("r2")];

    expect(summarize(repos)).toBeNull();
  });

  it("エラーのリポジトリは待たずに、数だけ数える", () => {
    const repos = [
      makeRepo("r1", { local: [makeBranch("main", { behind: 1 })] }),
      makeErrorRepo("r2", "ディレクトリが見つかりません"),
    ];

    expect(summarize(repos)).toEqual({
      repos: 2,
      local: 1,
      remote: 0,
      behind: 1,
      behindRepos: 1,
      ahead: 0,
      aheadRepos: 0,
      dirtyRepos: 0,
      worktrees: 0,
    });
  });

  it("他のワークツリーだけが変更されているリポジトリは数えない", () => {
    const repos = [
      makeRepo("r1", {
        changes: makeChanges([]),
        worktrees: [makeWorktree("dev/x", "/wt/x", { changes: makeChanges(["a.ts"]) })],
      }),
    ];

    expect(summarize(repos)?.dirtyRepos).toBe(0);
  });

  it("登録が無ければ 0 が並ぶ", () => {
    expect(summarize([])).toEqual({
      repos: 0,
      local: 0,
      remote: 0,
      behind: 0,
      behindRepos: 0,
      ahead: 0,
      aheadRepos: 0,
      dirtyRepos: 0,
      worktrees: 0,
    });
  });
});
