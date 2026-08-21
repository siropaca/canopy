import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoState, RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { useRepoStore } from "@/store/useRepoStore";
import {
  makeBranch,
  makeChanges,
  makeCommandResult,
  makeErrorRepo,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeWorktree,
} from "@/test/factories";

import { DetailPane, type DetailActions } from "./DetailPane";

/** ボタンの押し先。テストごとに見たいものだけ差し替える */
function makeActions(overrides: Partial<DetailActions> = {}): DetailActions {
  return {
    onFetch: vi.fn(),
    onPull: vi.fn(),
    onCheckout: vi.fn(),
    onCheckoutAndPull: vi.fn(),
    onPush: vi.fn(),
    onCopy: vi.fn(),
    onRemoveRepo: vi.fn(),
    ...overrides,
  };
}

/** ストアに 1 件入れて、全部開いた行を作る */
function setup(snapshot: Partial<RepoSnapshot>, state: Partial<RepoState> = {}): RowNode[] {
  const repo = makeRepo("r1", snapshot, state);
  useRepoStore.setState({
    byId: new Map([[repo.id, repo]]),
    order: [repo.id],
    loaded: true,
    loadError: null,
    lastResult: new Map(),
    running: new Map(),
  });
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local", "remote", "tag"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function find(rows: RowNode[], kind: RowNode["kind"]): RowNode {
  const row = rows.find((candidate) => candidate.kind === kind);
  if (row === undefined) throw new Error(`${kind} の行が無い`);
  return row;
}

/** 定義リストを「見出し -> 値」で読む */
function pairs(): [string, string][] {
  const list = document.querySelector("dl");
  if (list === null) return [];
  const terms = [...list.querySelectorAll("dt")];
  const values = [...list.querySelectorAll("dd")];
  return terms.map((term, index) => [term.textContent ?? "", values[index]?.textContent ?? ""]);
}

describe("詳細ペイン", () => {
  beforeEach(() => {
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: true,
      loadError: null,
      lastResult: new Map(),
      running: new Map(),
    });
  });

  it("選択が無ければ「ブランチを選択」", () => {
    render(<DetailPane row={null} actions={makeActions({ onRemoveRepo: vi.fn() })} />);

    expect(screen.getByText("ブランチを選択")).toBeDefined();
  });

  it("括りを選んでいるときも「ブランチを選択」", () => {
    const rows = setup({ local: [makeBranch("main")] });

    render(
      <DetailPane row={find(rows, "section")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(screen.getByText("ブランチを選択")).toBeDefined();
  });

  it("リポジトリは origin・ブランチ数・現在・未コミットを出す", () => {
    const rows = setup({
      local: [makeBranch("main", { is_current: true }), makeBranch("develop")],
      remote: [makeRef("origin/main")],
      changes: makeChanges(["a.ts", "b.ts"]),
    });

    render(
      <DetailPane row={find(rows, "repo")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs()).toEqual([
      ["origin", "https://github.com/acme/acme-api"],
      ["ブランチ", "ローカル 2 / リモート 1"],
      ["現在", "main"],
      ["未コミット", "2 ファイル"],
    ]);
  });

  it("detached HEAD は「現在」を detached (参照名) で出す", () => {
    const rows = setup({ head: { kind: "detached", name: "v1.0.0" } });

    render(
      <DetailPane row={find(rows, "repo")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs()).toContainEqual(["現在", "detached (v1.0.0)"]);
  });

  it("リストから削除だけが動く。押すと id を渡す", () => {
    const rows = setup({});
    const onRemoveRepo = vi.fn();
    render(
      <DetailPane row={find(rows, "repo")} actions={makeActions({ onRemoveRepo: onRemoveRepo })} />,
    );

    screen.getByText("リストから削除").click();

    expect(onRemoveRepo).toHaveBeenCalledWith("r1");
  });

  it("現在のブランチには「— 現在のブランチ」を付ける", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(screen.getByText("acme-api — 現在のブランチ")).toBeDefined();
    expect(screen.getByText("プル")).toBeDefined();
    expect(screen.getByText("プッシュ")).toBeDefined();
  });

  it("他のローカルブランチはチェックアウトのボタンを出す", () => {
    const rows = setup({ local: [makeBranch("develop")] });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(screen.getByText("チェックアウト")).toBeDefined();
    expect(screen.getByText("チェックアウトとプル")).toBeDefined();
  });

  it("追跡が消えているブランチは削除済みと出す", () => {
    const rows = setup({
      local: [makeBranch("dev/old", { upstream: "origin/dev/old", upstream_gone: true })],
    });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs()).toContainEqual(["追跡", "origin/dev/old (削除済み)"]);
  });

  it("追跡が未設定なら「なし」。`origin/<名前>` と決め打ちしない", () => {
    const rows = setup({ local: [makeBranch("local-only", { upstream: null })] });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs()).toContainEqual(["追跡", "なし"]);
  });

  it("ワークツリーにあるブランチはそのパスと変更を出す", () => {
    const rows = setup({
      local: [makeBranch("dev/side", { worktree_path: "/Users/dev/worktrees/side" })],
      worktrees: [
        makeWorktree("dev/side", "/Users/dev/worktrees/side", {
          changes: makeChanges(["only-here.ts"]),
        }),
      ],
    });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs()).toContainEqual(["ワークツリー", "side ~/worktrees/side"]);
    expect(pairs()).toContainEqual(["未コミット", "1 ファイル"]);
    expect(screen.getByText("未コミットの変更 (1)")).toBeDefined();
  });

  it("**タグに「追跡」と「差分」を出さない** (モックは出しているが誤り)", () => {
    const rows = setup({ tags: [makeRef("v1.0.0")] });

    render(<DetailPane row={find(rows, "tag")} actions={makeActions({ onRemoveRepo: vi.fn() })} />);

    expect(pairs().map(([term]) => term)).toEqual(["種別", "最終コミット"]);
    expect(screen.getByText("タグ")).toBeDefined();
  });

  it("リモートブランチにも「追跡」と「差分」を出さない", () => {
    const rows = setup({ remote: [makeRef("origin/main")] });

    render(
      <DetailPane row={find(rows, "remote")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(pairs().map(([term]) => term)).toEqual(["種別", "最終コミット"]);
    expect(screen.getByText("リモート")).toBeDefined();
    // メニューと揃える。リモートに対してプッシュもチェックアウトとプルも出さない
    expect(screen.queryByText("チェックアウトとプル")).toBeNull();
    expect(screen.queryByText("プッシュ")).toBeNull();
  });

  it("未コミットは 20 件までで、残りは「他 n 件」にまとめる", () => {
    const paths = Array.from({ length: 21 }, (_, index) => `file-${index}.ts`);
    const rows = setup({
      local: [makeBranch("main", { is_current: true })],
      changes: makeChanges(paths, 25),
    });

    render(
      <DetailPane row={find(rows, "branch")} actions={makeActions({ onRemoveRepo: vi.fn() })} />,
    );

    expect(screen.getByText("未コミットの変更 (25)")).toBeDefined();
    expect(screen.getByText("他 5 件")).toBeDefined();
    expect(screen.queryByText("file-20.ts")).toBeNull();
  });

  it("読み込み中のリポジトリは見出しと状態を出す", () => {
    const repo = makeLoadingRepo("r1", "acme-api");
    useRepoStore.setState({
      byId: new Map([["r1", repo]]),
      order: ["r1"],
      loaded: true,
      loadError: null,
    });
    const rows = flatten([repo], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    render(<DetailPane row={rows[0] ?? null} actions={makeActions({ onRemoveRepo: vi.fn() })} />);

    expect(screen.getByText("acme-api")).toBeDefined();
    expect(pairs()).toEqual([["状態", "読み込み中"]]);
  });

  it("エラーのリポジトリは理由と「リストから削除」を出す。外す導線を切らさない", () => {
    const repo = makeErrorRepo("r1", "ディレクトリが見つかりません", "acme-api");
    useRepoStore.setState({
      byId: new Map([["r1", repo]]),
      order: ["r1"],
      loaded: true,
      loadError: null,
    });
    const rows = flatten([repo], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });
    const onRemoveRepo = vi.fn();

    render(
      <DetailPane row={rows[0] ?? null} actions={makeActions({ onRemoveRepo: onRemoveRepo })} />,
    );
    screen.getByText("リストから削除").click();

    expect(pairs()).toEqual([["状態", "ディレクトリが見つかりません"]]);
    expect(onRemoveRepo).toHaveBeenCalledWith("r1");
  });
});

describe("ボタン", () => {
  function button(label: string): HTMLButtonElement {
    const found = screen.getByText(label);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} がボタンではない`);
    return found;
  }

  it("リポジトリのボタンは仕様どおり (docs/specs/ui.md の「詳細ペイン」)", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    const onFetch = vi.fn();

    render(<DetailPane row={find(rows, "repo")} actions={makeActions({ onFetch })} />);

    fireEvent.click(button("フェッチ"));
    expect(onFetch).toHaveBeenCalledOnce();
  });

  it("パスをコピーは実際のパスを渡す", () => {
    const rows = setup({ path: "/repos/acme-api", local: [makeBranch("main")] });
    const onCopy = vi.fn();

    render(<DetailPane row={find(rows, "repo")} actions={makeActions({ onCopy })} />);
    fireEvent.click(button("パスをコピー"));

    expect(onCopy).toHaveBeenCalledExactlyOnceWith("r1", "/repos/acme-api");
  });

  it("現在のブランチはプルとプッシュ、他のローカルはチェックアウトを出す", () => {
    const rows = setup({
      local: [makeBranch("main", { is_current: true }), makeBranch("side")],
    });

    render(<DetailPane row={find(rows, "branch")} actions={makeActions()} />);
    expect(screen.queryByText("チェックアウト")).toBeNull();
    expect(screen.getByText("プル")).toBeDefined();
    expect(screen.getByText("プッシュ")).toBeDefined();
  });

  it("`gone` のブランチはプルのボタンを無効にする", () => {
    const rows = setup({
      local: [makeBranch("main", { is_current: true, upstream_gone: true })],
    });

    render(<DetailPane row={find(rows, "branch")} actions={makeActions()} />);

    expect(button("プル").disabled).toBe(true);
  });

  it("`⧉` が付いたブランチはチェックアウトのボタンを無効にする", () => {
    const rows = setup({
      local: [makeBranch("held", { worktree_path: "/wt/held" })],
      worktrees: [makeWorktree("held", "/wt/held")],
    });

    render(<DetailPane row={find(rows, "branch")} actions={makeActions()} />);

    expect(button("チェックアウト").disabled).toBe(true);
    expect(button("チェックアウトとプル").disabled).toBe(true);
  });

  it("実行中はボタンを無効にする (docs/specs/ui.md の「実行中の扱い」)", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] }, { running: true });

    render(<DetailPane row={find(rows, "branch")} actions={makeActions()} />);

    expect(button("プル").disabled).toBe(true);
    expect(button("プッシュ").disabled).toBe(true);
  });

  it("プッシュはダイアログを開く", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    const onPush = vi.fn();

    render(<DetailPane row={find(rows, "branch")} actions={makeActions({ onPush })} />);
    fireEvent.click(button("プッシュ"));

    expect(onPush).toHaveBeenCalledOnce();
  });
});

describe("最後の結果", () => {
  it("成功した結果とコマンドを出す", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    useRepoStore.getState().setResult("r1", makeCommandResult({ message: null }));

    render(<DetailPane row={find(rows, "repo")} actions={makeActions()} />);

    expect(screen.getByText("最後の結果")).toBeDefined();
    expect(screen.getByText("成功しました")).toBeDefined();
    expect(screen.getByText("git fetch --prune")).toBeDefined();
  });

  it("失敗の文言を出す。**握りつぶさない**", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    useRepoStore.getState().setResult(
      "r1",
      makeCommandResult({
        ok: false,
        message: "プルに失敗しました (未コミットの変更あり)",
        steps: [{ command: "git pull --rebase", code: 1, stdout: "", stderr: "error" }],
      }),
    );

    render(<DetailPane row={find(rows, "repo")} actions={makeActions()} />);

    expect(screen.getByText("プルに失敗しました (未コミットの変更あり)")).toBeDefined();
    expect(screen.getByText("git pull --rebase")).toBeDefined();
  });

  it("2 段の操作は両方のコマンドを出す", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    useRepoStore.getState().setResult(
      "r1",
      makeCommandResult({
        steps: [
          { command: "git switch --end-of-options topic", code: 0, stdout: "", stderr: "" },
          { command: "git pull --rebase", code: 0, stdout: "", stderr: "" },
        ],
      }),
    );

    render(<DetailPane row={find(rows, "repo")} actions={makeActions()} />);

    expect(screen.getByText("git switch --end-of-options topic")).toBeDefined();
    expect(screen.getByText("git pull --rebase")).toBeDefined();
  });

  /** 省略は失敗ではない。赤で出すとフェーズ 3 のトーストが同じ間違いをする */
  it("省略された操作は失敗の色にしない", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });
    useRepoStore.getState().setResult(
      "r1",
      makeCommandResult({
        kind: "skipped",
        ok: false,
        steps: [],
        message: "同じ操作を実行中です",
      }),
    );

    render(<DetailPane row={find(rows, "repo")} actions={makeActions()} />);

    const line = screen.getByText("同じ操作を実行中です");
    expect(line.className).not.toContain("resultFailed");
  });

  it("結果が無ければ何も出さない", () => {
    const rows = setup({ local: [makeBranch("main", { is_current: true })] });

    render(<DetailPane row={find(rows, "repo")} actions={makeActions()} />);

    expect(screen.queryByText("最後の結果")).toBeNull();
  });

  it("読めていないリポジトリでも結果は出す", () => {
    useRepoStore.setState({
      byId: new Map([["r1", makeErrorRepo("r1", "ディレクトリが見つかりません")]]),
      order: ["r1"],
      loaded: true,
      loadError: null,
      lastResult: new Map(),
      running: new Map(),
    });
    const rows = flatten([makeErrorRepo("r1", "ディレクトリが見つかりません")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });
    useRepoStore
      .getState()
      .setResult(
        "r1",
        makeCommandResult({ ok: false, message: "フェッチに失敗しました", steps: [] }),
      );

    render(<DetailPane row={rows[0] ?? null} actions={makeActions()} />);

    expect(screen.getByText("フェッチに失敗しました")).toBeDefined();
  });
});
