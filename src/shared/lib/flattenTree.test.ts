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
import { allKeys, allKeysOf, defaultExpanded } from "./treeKeys";

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

  /**
   * 検索中は全部開いて見えるので、シェブロンを押しても**見た目は変わらない**。
   * 変わるのは保存する折りたたみだけ (docs/specs/ui.md の「検索」)。
   * 押した結果は検索を消したときに現れる。
   */
  it("検索中に折りたたみを畳んでも、検索中の見た目は変わらない", () => {
    const opened = new Set(["r1|repo|", "r1|local|"]);
    const searching = options({ query: "rec-482", expanded: opened });

    const before = outline(flatten([repo], searching));
    const closed = new Set([...opened].filter((key) => key !== "r1|local|"));
    const after = outline(flatten([repo], { ...searching, expanded: closed }));

    expect(after).toEqual(before);
    // 検索を消すと、押した結果 (ローカルが閉じている) が出る
    expect(outline(flatten([repo], options({ expanded: closed })))).toEqual([
      "repo:acme-api",
      "  section:ローカル",
      "  section:リモート",
      "  section:タグ",
    ]);
  });

  it("`expanded` を書き換えない (保存した折りたたみを汚さない)", () => {
    const expanded = new Set(["r1|repo|"]);

    flatten([repo], options({ query: "rec-482", expanded }));

    expect([...expanded]).toEqual(["r1|repo|"]);
  });

  /** まだ読めていないリポジトリは「ヒット無し」と区別する。起動直後に全部薄くなる */
  it("読み込み中のリポジトリは検索中でもヒット扱いにする", () => {
    const rows = flatten([makeLoadingRepo("r9")], options({ query: "rec" }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind === "repo" && rows[0].matched).toBe(true);
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

/*
 * リポジトリ単位のメモ化。
 *
 * 1 文字打つごとに全リポジトリの ref をツリー化するので、変わっていない
 * リポジトリは作り直さない (docs/plans/phase-3-around.md)。
 * 行のオブジェクトが同じままなら、`TreeRow` (memo) の再描画も起きない。
 */
describe("flatten のメモ化", () => {
  const repos = [
    makeRepo("r1", { local: [makeBranch("main"), makeBranch("feature/a")] }),
    makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
  ];
  const expanded = new Set(allKeysOf(repos, ["local", "remote", "tag"]));

  it("同じ入力なら行を作り直さない", () => {
    const first = flatten(repos, options({ expanded }));
    const second = flatten(repos, options({ expanded }));

    expect(second).not.toBe(first);
    for (const [index, row] of second.entries()) {
      expect(row, row.key).toBe(first[index]);
    }
  });

  it("別のリポジトリを折りたたんでも、関係ないリポジトリの行は作り直さない", () => {
    const before = flatten(repos, options({ expanded }));

    const narrowed = new Set([...expanded].filter((key) => !key.startsWith("r1|")));
    const after = flatten(repos, options({ expanded: narrowed }));

    const untouched = (rows: readonly RowNode[]) => rows.filter((row) => row.repoId === "r2");
    for (const [index, row] of untouched(after).entries()) {
      expect(row, row.key).toBe(untouched(before)[index]);
    }
  });

  it("検索を消すと元の並びに戻る", () => {
    const before = outline(flatten(repos, options({ expanded })));

    flatten(repos, options({ expanded, query: "feature" }));
    const after = outline(flatten(repos, options({ expanded })));

    expect(after).toEqual(before);
  });

  /** `r1` と `r10` を前方一致で混ぜない。Rust 側も同じ境界をテストしている */
  it("id が前方一致する別のリポジトリを開いても作り直さない", () => {
    const many = [
      makeRepo("r1", { local: [makeBranch("main")] }),
      makeRepo("r10", { name: "acme-ops", local: [makeBranch("main")] }),
    ];
    const opened = new Set(allKeysOf(many, ["local"]));
    const before = flatten(many, options({ expanded: opened }));

    // r10 だけ畳む
    const narrowed = new Set([...opened].filter((key) => !key.startsWith("r10|")));
    const after = flatten(many, options({ expanded: narrowed }));

    expect(after[0]).toBe(before[0]);
  });

  /** ブランチ名には `,` も `|` も入る。鍵をつないだ文字列が衝突しないこと */
  it("鍵をつないだときに別の折りたたみ状態と衝突しない", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("a/x"), makeBranch("b/y"), makeBranch("a,r1|local|b/z")],
    });
    const one = new Set(["r1|repo|", "r1|local|", "r1|local|a,r1|local|b"]);
    const two = new Set(["r1|repo|", "r1|local|", "r1|local|a", "r1|local|b"]);

    const first = outline(flatten([repo], options({ expanded: one })));
    const second = outline(flatten([repo], options({ expanded: two })));

    expect(second).not.toEqual(first);
  });

  it("スナップショットが変わったら作り直す", () => {
    const before = flatten(repos, options({ expanded }));

    const updated = [{ ...repos[0]!, snapshot: repos[0]!.snapshot }, repos[1]!];
    const after = flatten(updated, options({ expanded }));

    expect(after[0]).not.toBe(before[0]);
  });
});
