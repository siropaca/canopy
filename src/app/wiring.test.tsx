import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * サイドバーのボタンと store のアクションの配線。
 *
 * **App.test.tsx とは分ける。** あちらは再描画の回数を数えるためにサイドバーを
 * 差し替えているので、本物のボタンを押せない。押す相手を見ないテストは、
 * 相手を取り違えても緑になる (docs/testing.md の「配線を見ていない呼び出し」)。
 */

vi.mock("@/store/bootstrap");
vi.mock("@/store/events");
vi.mock("@/store/persist");
vi.mock("@/store/refresh");
vi.mock("@/store/opsActions");

vi.mock("@/features/repo-tree/RepoTree", () => ({
  RepoTree: () => <div data-testid="tree" />,
  TreePane: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-testid="tree-pane">{children}</div>
  ),
}));

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { makeBranch, makeRepo } from "@/test/factories";
import * as bootstrap from "@/store/bootstrap";
import * as events from "@/store/events";
import * as ops from "@/store/opsActions";
import * as refresh from "@/store/refresh";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import { App } from "./App";

/** ローカルブランチを 1 つ選んだ状態にする。鍵は `flatten` から取る */
function selectBranch(label: string): void {
  const repo = makeRepo("r1", {
    local: [makeBranch("main", { is_current: true }), makeBranch("side")],
  });
  useRepoStore.setState({
    byId: new Map([["r1", repo]]),
    order: ["r1"],
    loaded: true,
    loadError: null,
    running: new Map(),
  });
  const expanded = allKeysOf([repo], ["local"]);
  useUiStore.getState().setExpanded(expanded);
  const rows: RowNode[] = flatten([repo], {
    expanded: new Set(expanded),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
  const row = rows.find((candidate) => candidate.kind === "branch" && candidate.label === label);
  if (row === undefined) throw new Error(`${label} の行が無い`);
  useUiStore.getState().select(row.key);
}

beforeEach(() => {
  vi.mocked(bootstrap.loadEverything).mockResolvedValue(undefined);
  vi.mocked(events.listenForRepoUpdates).mockResolvedValue(vi.fn());
  vi.mocked(events.listenForRepoChanges).mockResolvedValue(vi.fn());
  vi.mocked(events.watchWindowVisibility).mockReturnValue(vi.fn());
  vi.mocked(refresh.refreshAllRepositories).mockResolvedValue(undefined);
  useRepoStore.setState({
    byId: new Map(),
    order: [],
    loaded: false,
    loadError: null,
    running: new Map(),
  });
  useUiStore.getState().select(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("サイドバーの配線", () => {
  /** ターミナルで動かした結果を映す手動の引き金 (docs/adr/0022-auto-refresh.md) */
  it("更新を押すと全リポジトリを取り直す", () => {
    render(<App />);

    screen.getByLabelText("更新").click();

    expect(refresh.refreshAllRepositories).toHaveBeenCalledOnce();
  });

  /** 更新でネットワークまで触らない。フェッチは押されたときだけ */
  it("更新はフェッチを起こさない", () => {
    render(<App />);

    screen.getByLabelText("更新").click();

    expect(ops.fetchAllRepositories).not.toHaveBeenCalled();
    expect(ops.fetchRepository).not.toHaveBeenCalled();
  });

  /** 逆向きも見る。フェッチのボタンが取り直しに化けていないこと */
  it("フェッチを押しても取り直しだけにはならない", () => {
    render(<App />);

    screen.getByLabelText("フェッチ").click();

    expect(ops.fetchAllRepositories).toHaveBeenCalledOnce();
    expect(refresh.refreshAllRepositories).not.toHaveBeenCalled();
  });
});

describe("ブランチの削除の配線", () => {
  /**
   * ボタン → ダイアログ → `deleteBranch` までを通す。
   * 途中を切っても、押す側と押される側を別々に見るテストは緑のままになる
   * (docs/testing.md の「配線を見ていない呼び出し」)
   */
  it("サイドバーから開いたダイアログの確定が、強制の指定ごと届く", () => {
    vi.mocked(ops.deleteBranch).mockResolvedValue({
      kind: "ran",
      ok: true,
      steps: [],
      message: null,
    });
    selectBranch("side");
    render(<App />);

    fireEvent.click(screen.getByLabelText("ブランチの削除"));
    expect(screen.getByText("ブランチ side を削除")).toBeDefined();

    fireEvent.click(screen.getByLabelText("マージされていなくても削除"));
    fireEvent.click(screen.getByText("強制削除"));

    expect(ops.deleteBranch).toHaveBeenCalledExactlyOnceWith("r1", "side", true);
  });

  it("現在のブランチを選んでいるときは押せない", () => {
    selectBranch("main");
    render(<App />);

    expect(screen.getByLabelText("ブランチの削除").hasAttribute("disabled")).toBe(true);
  });
});

describe("イベントの購読", () => {
  /** `.git` の変化は Rust から届く (docs/adr/0022-auto-refresh.md) */
  it("起動時に、一括フェッチの結果と `.git` の変化の両方を購読する", () => {
    render(<App />);

    expect(events.listenForRepoUpdates).toHaveBeenCalledOnce();
    expect(events.listenForRepoChanges).toHaveBeenCalledOnce();
  });
});
