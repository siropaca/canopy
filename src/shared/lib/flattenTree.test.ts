import { describe, expect, it } from "vitest";

import type { RepoState, RowNode } from "@/ipc/types";
import {
  makeBranch,
  makeChanges,
  makeErrorRepo,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeWorktree,
} from "@/test/factories";

import { MAX_DEPTH, flatten, type FlattenOptions } from "./flattenTree";
import { allKeys, defaultExpanded } from "./treeKeys";

const DEFAULTS: FlattenOptions = {
  expanded: new Set<string>(),
  query: "",
  groupDirectories: true,
  localOnly: false,
};

function options(overrides: Partial<FlattenOptions> = {}): FlattenOptions {
  return { ...DEFAULTS, ...overrides };
}

/** 行を「深さ + 種別 + 表示名」で読みやすく並べる */
function outline(rows: readonly RowNode[]): string[] {
  return rows.map((row) => {
    const label =
      row.kind === "repo"
        ? row.repo.name
        : row.kind === "branch"
          ? row.label
          : row.kind === "section" || row.kind === "directory"
            ? row.label
            : row.label;
    return `${"  ".repeat(row.depth)}${row.kind}:${label}`;
  });
}

function expandedFor(repo: RepoState): Set<string> {
  if (repo.snapshot === null) return new Set();
  return new Set(defaultExpanded(repo.id, repo.snapshot));
}

describe("flatten", () => {
  it("見出しだけを出す (既定では閉じている)", () => {
    const repos = [makeRepo("r1"), makeRepo("r2", { name: "acme-web" })];

    const rows = flatten(repos, options());

    expect(outline(rows)).toEqual(["repo:acme-api", "repo:acme-web"]);
    expect(rows[0]?.kind === "repo" && rows[0].expanded).toBe(false);
  });

  it("読み込み中とエラーのリポジトリも見出しを出す (docs/specs/ui.md)", () => {
    const repos = [makeLoadingRepo("r1"), makeErrorRepo("r2", "ディレクトリが見つかりません")];

    const rows = flatten(repos, options({ expanded: new Set(["r1|repo|", "r2|repo|"]) }));

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "repo")).toBe(true);
  });

  it("開いた括りの中身を出す。ディレクトリが先、葉が後", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("main"), makeBranch("feature/b"), makeBranch("feature/a")],
    });

    const rows = flatten([repo], options({ expanded: expandedFor(repo) }));

    expect(outline(rows)).toEqual([
      "repo:acme-api",
      "  section:ローカル",
      "    directory:feature",
      "      branch:a",
      "      branch:b",
      "    branch:main",
    ]);
  });

  it("名前は辞書順。数字は数として比べる", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("rec-10"), makeBranch("rec-2"), makeBranch("REC-1")],
    });

    const rows = flatten([repo], options({ expanded: expandedFor(repo) }));

    expect(outline(rows).slice(2)).toEqual([
      "    branch:REC-1",
      "    branch:rec-2",
      "    branch:rec-10",
    ]);
  });

  it("中身が無い括りは出さない", () => {
    const repo = makeRepo("r1", { local: [makeBranch("main")], remote: [], tags: [] });

    const rows = flatten(
      [repo],
      options({ expanded: new Set(allKeys("r1", repo.snapshot!, ["local", "remote", "tag"])) }),
    );

    expect(outline(rows)).toEqual(["repo:acme-api", "  section:ローカル", "    branch:main"]);
  });

  it("リモートとタグは開いた分だけ 1 段ずつ出す", () => {
    const repo = makeRepo("r1", {
      remote: [makeRef("origin/feature/x"), makeRef("origin/main")],
      tags: [makeRef("v1.0.0")],
    });

    const closed = flatten([repo], options({ expanded: new Set(["r1|repo|"]) }));
    const opened = flatten(
      [repo],
      options({ expanded: new Set(["r1|repo|", "r1|remote|", "r1|tag|"]) }),
    );

    expect(outline(closed)).toEqual(["repo:acme-api", "  section:リモート", "  section:タグ"]);
    expect(outline(opened)).toEqual([
      "repo:acme-api",
      "  section:リモート",
      "    directory:origin",
      "  section:タグ",
      "    tag:v1.0.0",
    ]);
  });

  it("グループ化をオフにすると完全な名前を 1 行で出す", () => {
    const repo = makeRepo("r1", {
      remote: [makeRef("origin/feature/x"), makeRef("origin/main")],
    });

    const rows = flatten(
      [repo],
      options({
        expanded: new Set(["r1|repo|", "r1|remote|"]),
        groupDirectories: false,
      }),
    );

    expect(outline(rows)).toEqual([
      "repo:acme-api",
      "  section:リモート",
      "    remote:origin/feature/x",
      "    remote:origin/main",
    ]);
  });

  it("ローカルのみ表示でリモートとタグを外す", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("main")],
      remote: [makeRef("origin/main")],
      tags: [makeRef("v1.0.0")],
    });

    const rows = flatten(
      [repo],
      options({
        expanded: new Set(allKeys("r1", repo.snapshot!, ["local", "remote", "tag"])),
        localOnly: true,
      }),
    );

    expect(outline(rows)).toEqual(["repo:acme-api", "  section:ローカル", "    branch:main"]);
  });

  it("深い階層はインデントの上限で止める", () => {
    const deep = Array.from({ length: MAX_DEPTH + 4 }, (_, index) => `d${index}`).join("/");
    const repo = makeRepo("r1", { local: [makeBranch(deep)] });

    const rows = flatten([repo], options({ expanded: expandedFor(repo) }));

    const depths = rows.map((row) => row.depth);
    expect(Math.max(...depths)).toBe(MAX_DEPTH);
    // 上限より深い行も消えない
    expect(rows.at(-1)?.kind).toBe("branch");
  });

  it("ブランチ行に、そのワークツリーの未コミット数を持たせる", () => {
    const repo = makeRepo("r1", {
      local: [
        makeBranch("main", { is_current: true }),
        makeBranch("dev/side", { worktree_path: "/worktrees/side" }),
        makeBranch("dev/idle"),
      ],
      changes: makeChanges(["a.ts", "b.ts"]),
      worktrees: [makeWorktree("dev/side", "/worktrees/side", { changes: makeChanges(["c.ts"]) })],
    });

    const rows = flatten([repo], options({ expanded: expandedFor(repo) }));

    const branches = rows.filter((row) => row.kind === "branch");
    expect(branches.map((row) => [row.label, row.dirtyCount, row.worktreeName])).toEqual([
      ["idle", 0, null],
      ["side", 1, "side"],
      ["main", 2, null],
    ]);
  });

  it("detached HEAD では現在ブランチの変更をどの行にも付けない", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("main"), makeBranch("develop")],
      changes: makeChanges(["a.ts"]),
      head: { kind: "detached", name: "v1.0.0" },
    });

    const rows = flatten([repo], options({ expanded: expandedFor(repo) }));

    const branches = rows.filter((row) => row.kind === "branch");
    expect(branches.map((row) => row.dirtyCount)).toEqual([0, 0]);
  });
});

describe("flatten の検索", () => {
  const repo = makeRepo("r1", {
    local: [makeBranch("feature/rec-482"), makeBranch("main")],
    remote: [makeRef("origin/feature/rec-482"), makeRef("origin/main")],
    tags: [makeRef("v1.0.0")],
  });

  it("折りたたみを無視して全部開く", () => {
    const rows = flatten([repo], options({ query: "rec-482", expanded: new Set() }));

    expect(outline(rows)).toEqual([
      "repo:acme-api",
      "  section:ローカル",
      "    directory:feature",
      "      branch:rec-482",
      "  section:リモート",
      "    directory:origin",
      "      directory:feature",
      "        remote:rec-482",
    ]);
  });

  it("`expanded` を書き換えない (保存した折りたたみを汚さない)", () => {
    const expanded = new Set(["r1|repo|"]);

    flatten([repo], options({ query: "rec-482", expanded }));

    expect([...expanded]).toEqual(["r1|repo|"]);
  });

  it("ヒットが無いリポジトリは見出しだけ残して薄くする", () => {
    const rows = flatten([repo, makeRepo("r2", { name: "acme-web" })], options({ query: "rec" }));

    const headings = rows.filter((row) => row.kind === "repo");
    expect(headings.map((row) => [row.repo.name, row.matched])).toEqual([
      ["acme-api", true],
      ["acme-web", false],
    ]);
    expect(outline(rows).filter((line) => line.includes("acme-web"))).toEqual(["repo:acme-web"]);
  });

  it("大文字小文字を区別しない (両方向)", () => {
    const mixed = makeRepo("r1", { local: [makeBranch("REC-1"), makeBranch("rec-2")] });

    // 小文字のクエリで大文字のブランチが当たる
    const lower = flatten([mixed], options({ query: "rec-1" }));
    // 大文字のクエリで小文字のブランチが当たる
    const upper = flatten([mixed], options({ query: "REC-2" }));

    expect(lower.filter((row) => row.kind === "branch").map((row) => row.label)).toEqual(["REC-1"]);
    expect(upper.filter((row) => row.kind === "branch").map((row) => row.label)).toEqual(["rec-2"]);
  });

  it("ローカルのみ表示のときはリモートとタグを検索対象から外す", () => {
    const rows = flatten([repo], options({ query: "v1.0.0", localOnly: true }));

    expect(outline(rows)).toEqual(["repo:acme-api"]);
    expect(rows[0]?.kind === "repo" && rows[0].matched).toBe(false);
  });

  it("空白だけの検索は「検索していない」として扱う", () => {
    const rows = flatten([repo], options({ query: "   " }));

    expect(outline(rows)).toEqual(["repo:acme-api"]);
    // 検索中なら matched が false になる。trim していれば true のまま
    expect(rows[0]?.kind === "repo" && rows[0].matched).toBe(true);
  });

  it("前後の空白を落としてから当てる", () => {
    const rows = flatten([repo], options({ query: "  rec-482  " }));

    expect(rows.filter((row) => row.kind === "branch").map((row) => row.label)).toEqual([
      "rec-482",
    ]);
  });
});
