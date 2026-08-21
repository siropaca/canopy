import { describe, expect, it } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import {
  makeBranch,
  makeErrorRepo,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeWorktree,
} from "@/test/factories";

import {
  canCheckout,
  canCheckoutAndPull,
  canCheckoutPrevious,
  canFetch,
  canForcePush,
  canPull,
  canPush,
  canRemoveRepo,
  canRename,
  hasMenu,
  isFoldable,
} from "./selection";

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

/** 種類ごとに 1 行ずつ揃った行 */
function allKinds(overrides: Parameters<typeof makeRepo>[2] = {}): RowNode[] {
  return rowsOf(
    makeRepo(
      "r1",
      {
        local: [makeBranch("main", { is_current: true }), makeBranch("feature/a")],
        remote: [makeRef("origin/main")],
        tags: [makeRef("v1.0.0")],
      },
      overrides,
    ),
  );
}

describe("isFoldable", () => {
  const rows = allKinds();

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

describe("hasMenu", () => {
  const rows = allKinds();

  it("見出し・ブランチ・タグ・リモートには出す", () => {
    expect(hasMenu(pick(rows, (row) => row.kind === "repo"))).toBe(true);
    expect(hasMenu(pick(rows, (row) => row.kind === "branch"))).toBe(true);
    expect(hasMenu(pick(rows, (row) => row.kind === "remote"))).toBe(true);
    expect(hasMenu(pick(rows, (row) => row.kind === "tag"))).toBe(true);
  });

  it("括りとディレクトリには出さない (docs/specs/ui.md)", () => {
    expect(hasMenu(pick(rows, (row) => row.kind === "section"))).toBe(false);
    expect(hasMenu(pick(rows, (row) => row.kind === "directory"))).toBe(false);
  });
});

describe("canPull", () => {
  it("選択が無ければ無効", () => {
    expect(canPull(null)).toBe(false);
  });

  it("リポジトリ行は有効", () => {
    const rows = rowsOf(makeRepo("r1", { local: [makeBranch("main", { is_current: true })] }));

    expect(canPull(pick(rows, (row) => row.kind === "repo"))).toBe(true);
  });

  it("detached HEAD のリポジトリ行は無効 (docs/specs/ui.md)", () => {
    const rows = rowsOf(
      makeRepo("r1", { local: [makeBranch("main")], head: { kind: "detached", name: "v1.0.0" } }),
    );

    expect(canPull(pick(rows, (row) => row.kind === "repo"))).toBe(false);
  });

  /** 現在ブランチの追跡先を見ないと、押した瞬間に必ず失敗する */
  it("現在ブランチの追跡先が消えているリポジトリ行は無効", () => {
    const gone = rowsOf(
      makeRepo("r1", {
        local: [makeBranch("main", { is_current: true, upstream_gone: true })],
      }),
    );
    const unset = rowsOf(
      makeRepo("r1", { local: [makeBranch("main", { is_current: true, upstream: null })] }),
    );

    expect(canPull(pick(gone, (row) => row.kind === "repo"))).toBe(false);
    expect(canPull(pick(unset, (row) => row.kind === "repo"))).toBe(false);
  });

  it("まだ読み込んでいないリポジトリ行は無効", () => {
    const options = {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    };
    const loading = flatten([makeLoadingRepo("r1")], options);
    const broken = flatten([makeErrorRepo("r2", "ディレクトリが見つかりません")], options);

    expect(canPull(loading[0] ?? null)).toBe(false);
    expect(canPull(broken[0] ?? null)).toBe(false);
  });

  it("ローカルブランチは有効", () => {
    const rows = rowsOf(makeRepo("r1", { local: [makeBranch("develop")] }));

    expect(canPull(pick(rows, (row) => row.kind === "branch"))).toBe(true);
  });

  it("追跡先が消えているブランチは無効 (必ず失敗するので)", () => {
    const rows = rowsOf(
      makeRepo("r1", { local: [makeBranch("dev/old", { upstream_gone: true })] }),
    );

    expect(canPull(pick(rows, (row) => row.kind === "branch"))).toBe(false);
  });

  it("追跡先が未設定のブランチは無効", () => {
    const rows = rowsOf(makeRepo("r1", { local: [makeBranch("solo", { upstream: null })] }));

    expect(canPull(pick(rows, (row) => row.kind === "branch"))).toBe(false);
  });

  it("`⧉` が付いたブランチは有効 (そのワークツリーで実行する)", () => {
    const rows = rowsOf(
      makeRepo("r1", {
        local: [makeBranch("held", { worktree_path: "/wt/held" })],
        worktrees: [makeWorktree("held", "/wt/held")],
      }),
    );

    expect(canPull(pick(rows, (row) => row.kind === "branch"))).toBe(true);
  });

  it("括り・ディレクトリ・リモート・タグは無効", () => {
    const rows = allKinds();

    expect(canPull(pick(rows, (row) => row.kind === "section"))).toBe(false);
    expect(canPull(pick(rows, (row) => row.kind === "directory"))).toBe(false);
    expect(canPull(pick(rows, (row) => row.kind === "remote"))).toBe(false);
    expect(canPull(pick(rows, (row) => row.kind === "tag"))).toBe(false);
  });
});

describe("canCheckout", () => {
  it("他のローカルブランチ・リモート・タグは有効", () => {
    const rows = allKinds();

    expect(canCheckout(pick(rows, (row) => row.kind === "branch" && row.label === "a"))).toBe(true);
    expect(canCheckout(pick(rows, (row) => row.kind === "remote"))).toBe(true);
    expect(canCheckout(pick(rows, (row) => row.kind === "tag"))).toBe(true);
  });

  it("現在のブランチは無効 (すでにそこにいる)", () => {
    const rows = allKinds();

    expect(canCheckout(pick(rows, (row) => row.kind === "branch" && row.label === "main"))).toBe(
      false,
    );
  });

  it("`⧉` が付いたブランチは無効 (必ず `already used by worktree at` で失敗する)", () => {
    const rows = rowsOf(
      makeRepo("r1", {
        local: [makeBranch("held", { worktree_path: "/wt/held" })],
        worktrees: [makeWorktree("held", "/wt/held")],
      }),
    );

    expect(canCheckout(pick(rows, (row) => row.kind === "branch"))).toBe(false);
  });

  it("リポジトリ・括り・ディレクトリは無効", () => {
    const rows = allKinds();

    expect(canCheckout(pick(rows, (row) => row.kind === "repo"))).toBe(false);
    expect(canCheckout(pick(rows, (row) => row.kind === "section"))).toBe(false);
    expect(canCheckout(pick(rows, (row) => row.kind === "directory"))).toBe(false);
  });
});

describe("canPush と canRename", () => {
  it("ローカルブランチだけ有効", () => {
    const rows = allKinds();
    const branch = pick(rows, (row) => row.kind === "branch");

    expect(canPush(branch)).toBe(true);
    expect(canRename(branch)).toBe(true);
    for (const kind of ["repo", "section", "directory", "remote", "tag"] as const) {
      const row = pick(rows, (item) => item.kind === kind);
      expect(canPush(row), kind).toBe(false);
      expect(canRename(row), kind).toBe(false);
    }
  });
});

describe("canFetch", () => {
  it("選択が無ければ有効 (全リポジトリが対象)", () => {
    expect(canFetch(null)).toBe(true);
  });

  it("どの種類の行でも有効", () => {
    for (const row of allKinds()) {
      expect(canFetch(row), row.kind).toBe(true);
    }
  });

  it("実行中のリポジトリを選んでいると無効", () => {
    for (const row of allKinds({ running: true })) {
      expect(canFetch(row), row.kind).toBe(false);
    }
  });
});

describe("canCheckoutAndPull", () => {
  it("チェックアウトとプルの両方ができるときだけ有効", () => {
    const rows = allKinds();
    expect(
      canCheckoutAndPull(pick(rows, (row) => row.kind === "branch" && row.label === "a")),
    ).toBe(true);
    // 現在のブランチはチェックアウトできない
    expect(
      canCheckoutAndPull(pick(rows, (row) => row.kind === "branch" && row.label === "main")),
    ).toBe(false);
    // タグはチェックアウトできるがプルできない
    expect(canCheckoutAndPull(pick(rows, (row) => row.kind === "tag"))).toBe(false);
  });

  it("`gone` のブランチは無効 (プルが必ず失敗する)", () => {
    const rows = rowsOf(
      makeRepo("r1", {
        local: [
          makeBranch("main", { is_current: true }),
          makeBranch("old", { upstream_gone: true }),
        ],
      }),
    );

    expect(
      canCheckoutAndPull(pick(rows, (row) => row.kind === "branch" && row.label === "old")),
    ).toBe(false);
  });
});

describe("canRemoveRepo", () => {
  it("リポジトリ行だけ有効", () => {
    const rows = allKinds();
    expect(canRemoveRepo(pick(rows, (row) => row.kind === "repo"))).toBe(true);
    for (const kind of ["section", "directory", "branch", "remote", "tag"] as const) {
      expect(canRemoveRepo(pick(rows, (row) => row.kind === kind)), kind).toBe(false);
    }
    expect(canRemoveRepo(null)).toBe(false);
  });

  /** 実行中に消すと、走っている操作の結果を捨てる先が無くなる */
  it("実行中は無効", () => {
    expect(canRemoveRepo(pick(allKinds({ running: true }), (row) => row.kind === "repo"))).toBe(
      false,
    );
  });
});

describe("canForcePush", () => {
  it("ahead が 0 なら無効 (リモートを巻き戻すだけの操作になる)", () => {
    expect(canForcePush(makeBranch("main", { ahead: 0, behind: 3 }))).toBe(false);
  });

  it("ahead があれば有効", () => {
    expect(canForcePush(makeBranch("main", { ahead: 1 }))).toBe(true);
  });
});

describe("canCheckoutPrevious", () => {
  it("detached HEAD のリポジトリ行だけ有効 (docs/specs/ui.md)", () => {
    const detached = rowsOf(
      makeRepo("r1", { local: [makeBranch("main")], head: { kind: "detached", name: "v1.0.0" } }),
    );
    const onBranch = rowsOf(makeRepo("r1", { local: [makeBranch("main", { is_current: true })] }));

    expect(canCheckoutPrevious(pick(detached, (row) => row.kind === "repo"))).toBe(true);
    expect(canCheckoutPrevious(pick(onBranch, (row) => row.kind === "repo"))).toBe(false);
    expect(canCheckoutPrevious(pick(detached, (row) => row.kind === "branch"))).toBe(false);
  });
});

describe("実行中のリポジトリ", () => {
  it("操作系の述語がすべて無効になる (docs/specs/ui.md の「実行中の扱い」)", () => {
    const rows = allKinds({ running: true });

    for (const row of rows) {
      expect(canPull(row), `canPull ${row.kind}`).toBe(false);
      expect(canCheckout(row), `canCheckout ${row.kind}`).toBe(false);
      expect(canCheckoutAndPull(row), `canCheckoutAndPull ${row.kind}`).toBe(false);
      expect(canPush(row), `canPush ${row.kind}`).toBe(false);
      expect(canRename(row), `canRename ${row.kind}`).toBe(false);
      expect(canCheckoutPrevious(row), `canCheckoutPrevious ${row.kind}`).toBe(false);
      expect(canFetch(row), `canFetch ${row.kind}`).toBe(false);
      expect(canRemoveRepo(row), `canRemoveRepo ${row.kind}`).toBe(false);
    }
  });

  it("折りたたみとメニューの表示自体は止めない", () => {
    const rows = allKinds({ running: true });

    expect(isFoldable(pick(rows, (row) => row.kind === "repo"))).toBe(true);
    expect(hasMenu(pick(rows, (row) => row.kind === "branch"))).toBe(true);
  });
});
