import { describe, expect, it } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { makeBranch, makeErrorRepo, makeLoadingRepo, makeRef, makeRepo } from "@/test/factories";

import { canPullSelection, isFoldable } from "./selection";

/** 全部開いた行を作る */
function rowsOf(repo: ReturnType<typeof makeRepo>): RowNode[] {
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local", "remote", "tag"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function pick(rows: RowNode[], predicate: (row: RowNode) => boolean): RowNode {
  const row = rows.find(predicate);
  if (row === undefined) throw new Error("行が無い");
  return row;
}

describe("isFoldable", () => {
  const rows = rowsOf(
    makeRepo("r1", {
      local: [makeBranch("feature/a")],
      remote: [makeRef("origin/main")],
      tags: [makeRef("v1.0.0")],
    }),
  );

  it("見出し・括り・ディレクトリは折りたためる", () => {
    expect(isFoldable(pick(rows, (row) => row.kind === "repo"))).toBe(true);
    expect(isFoldable(pick(rows, (row) => row.kind === "section"))).toBe(true);
    expect(isFoldable(pick(rows, (row) => row.kind === "directory"))).toBe(true);
  });

  it("葉は折りたためない", () => {
    expect(isFoldable(pick(rows, (row) => row.kind === "branch"))).toBe(false);
    expect(isFoldable(pick(rows, (row) => row.kind === "remote"))).toBe(false);
    expect(isFoldable(pick(rows, (row) => row.kind === "tag"))).toBe(false);
  });
});

describe("canPullSelection", () => {
  it("選択が無ければ無効", () => {
    expect(canPullSelection(null)).toBe(false);
  });

  it("リポジトリ行は有効", () => {
    const rows = rowsOf(makeRepo("r1", { local: [makeBranch("main", { is_current: true })] }));

    expect(canPullSelection(pick(rows, (row) => row.kind === "repo"))).toBe(true);
  });

  it("detached HEAD のリポジトリ行は無効 (docs/specs/ui.md)", () => {
    const rows = rowsOf(
      makeRepo("r1", { local: [makeBranch("main")], head: { kind: "detached", name: "v1.0.0" } }),
    );

    expect(canPullSelection(pick(rows, (row) => row.kind === "repo"))).toBe(false);
  });

  it("まだ読み込んでいないリポジトリ行は無効", () => {
    const loading = flatten([makeLoadingRepo("r1")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });
    const broken = flatten([makeErrorRepo("r2", "ディレクトリが見つかりません")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    expect(canPullSelection(loading[0] ?? null)).toBe(false);
    expect(canPullSelection(broken[0] ?? null)).toBe(false);
  });

  it("ローカルブランチは有効", () => {
    const rows = rowsOf(makeRepo("r1", { local: [makeBranch("develop")] }));

    expect(canPullSelection(pick(rows, (row) => row.kind === "branch"))).toBe(true);
  });

  it("追跡先が消えているブランチは無効 (必ず失敗するので)", () => {
    const rows = rowsOf(
      makeRepo("r1", { local: [makeBranch("dev/old", { upstream_gone: true })] }),
    );

    expect(canPullSelection(pick(rows, (row) => row.kind === "branch"))).toBe(false);
  });

  it("括り・ディレクトリ・リモート・タグは無効", () => {
    const rows = rowsOf(
      makeRepo("r1", {
        local: [makeBranch("feature/a")],
        remote: [makeRef("origin/main")],
        tags: [makeRef("v1.0.0")],
      }),
    );

    expect(canPullSelection(pick(rows, (row) => row.kind === "section"))).toBe(false);
    expect(canPullSelection(pick(rows, (row) => row.kind === "directory"))).toBe(false);
    expect(canPullSelection(pick(rows, (row) => row.kind === "remote"))).toBe(false);
    expect(canPullSelection(pick(rows, (row) => row.kind === "tag"))).toBe(false);
  });
});
