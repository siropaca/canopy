import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { RepoState } from "@/ipc/types";
import { SpinnerIcon } from "@/shared/ui/icons";
import { useBulkFetchStore } from "@/store/useBulkFetchStore";
import { useRepoStore } from "@/store/useRepoStore";
import {
  makeBranch,
  makeChanges,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeWorktree,
} from "@/test/factories";

import { StatusBar } from "./StatusBar";

function seed(repos: RepoState[]): void {
  useRepoStore.setState({
    byId: new Map(repos.map((repo) => [repo.id, repo])),
    order: repos.map((repo) => repo.id),
    loaded: true,
    loadError: null,
  });
}

/** 回るアイコンが持つ class。期待値は本物のアイコンから取る */
function spinnerClass(): string {
  const { container, unmount } = render(<SpinnerIcon />);
  const found = container.querySelector("svg")?.getAttribute("class") ?? "";
  unmount();
  return found;
}

/** 表示を「セルごとの文字」で読む */
function cells(container: HTMLElement): string[] {
  return [...(container.firstElementChild?.children ?? [])].map((cell) => cell.textContent ?? "");
}

describe("ステータスバー", () => {
  beforeEach(() => {
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: false,
      loadError: null,
      running: new Map(),
      reading: new Set(),
    });
    useBulkFetchStore.getState().reset();
  });

  /**
   * 実行中は `orderedRepos` が行を写し直す。写すたびに新しいオブジェクトを
   * 作ると `useShallow` の比較が毎回外れて、**再描画が止まらなくなる**
   * (実機で画面が真っ白になった)。
   */
  it("実行中のリポジトリがあっても描き続けない (無限ループにならない)", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "fetch");

    const { container } = render(<StatusBar />);

    expect(cells(container)[1]).toBe("1 リポジトリ");
  });

  /*
   * いま何をしているか (docs/adr/0023-progress-in-the-status-bar.md)。
   *
   * **ボタンが灰色になるだけだと固まって見える。** 組み立ては
   * `shared/lib/activity.ts` が持っているので、ここは出す・出さないを見る。
   */

  it("何も走っていなければ実行中は出さない", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);

    const { container } = render(<StatusBar />);

    expect(cells(container)[0]).toBe("1 リポジトリ");
  });

  it("書き込みの最中は、集計より先に何をしているかを出す", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "push");

    const { container } = render(<StatusBar />);

    expect(cells(container)[0]).toBe("acme-api をプッシュ中");
  });

  /**
   * 止まっていないことが分かるように、回るアイコンを 1 つだけ添える。
   *
   * **どのアイコンかまで見る。** 「svg がある」だけだと、止まっている矢印に
   * 差し替えても通る (docs/testing.md の「『違うこと』しか見ていない比較」)
   */
  it("実行中には回るアイコンを添える", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "pull");

    const { container } = render(<StatusBar />);

    const shown = container.firstElementChild?.firstElementChild?.querySelector("svg");
    expect(shown, "実行中にアイコンが無い").not.toBeNull();
    expect(shown?.getAttribute("class"), "回るアイコンではない").toBe(spinnerClass());
  });

  /** 「更新」を押して無反応なのがいちばん困る (ADR-0023) */
  it("取り直しの最中も出す", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRead("r1");

    const { container } = render(<StatusBar />);

    expect(cells(container)[0]).toBe("acme-api を更新中");
  });

  it("終わると消えて、集計だけに戻る", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "fetch");
    const { container, rerender } = render(<StatusBar />);
    expect(cells(container)[0]).toBe("acme-api をフェッチ中");

    useRepoStore.getState().endRun("r1", "fetch");
    rerender(<StatusBar />);

    expect(cells(container)[0]).toBe("1 リポジトリ");
  });

  /*
   * **描いたあとに始まる変化を見る** (docs/plans/phase-6-progress.md の完了条件)。
   *
   * 状態を作ってから `render` する形だけだと、`useActivity` がストアを購読して
   * いなくても全部緑になる。「更新」を押しても文言が出ない、という壊れ方が素通りする。
   */

  it("描いたあとに取り直しが始まっても出る", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    const { container } = render(<StatusBar />);
    expect(cells(container)[0]).toBe("1 リポジトリ");

    act(() => {
      useRepoStore.getState().beginRead("r1");
    });

    expect(cells(container)[0]).toBe("acme-api を更新中");
  });

  it("描いたあとに書き込みが始まっても出る", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    const { container } = render(<StatusBar />);

    act(() => {
      useRepoStore.getState().beginRun("r1", "push");
    });

    expect(cells(container)[0]).toBe("acme-api をプッシュ中");
  });

  /** 進み具合が進まないと、残りが見えない */
  it("描いたあとに一括フェッチが進むと数が増える", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    const { container } = render(<StatusBar />);

    act(() => {
      useBulkFetchStore.getState().start(["r1", "r2", "r3"]);
    });
    expect(cells(container)[0]).toBe("フェッチ 0 / 3");

    act(() => {
      useBulkFetchStore.getState().note("r2", true);
    });

    expect(cells(container)[0]).toBe("フェッチ 1 / 3");
  });

  it("描いたあとに終われば消える", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "fetch");
    const { container } = render(<StatusBar />);

    act(() => {
      useRepoStore.getState().endRun("r1", "fetch");
    });

    expect(cells(container)[0]).toBe("1 リポジトリ");
  });

  /** 11 件が順に返るので、残りが見えないと終わりが読めない */
  it("一括フェッチは進み具合を出す", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] })]);
    useRepoStore.getState().beginRun("r1", "fetch");
    useBulkFetchStore.getState().start(["r1", "r2", "r3"]);
    useBulkFetchStore.getState().note("r2", true);

    const { container } = render(<StatusBar />);

    expect(cells(container)[0]).toBe("フェッチ 1 / 3");
  });

  it("揃ったら合計を出す", () => {
    seed([
      makeRepo("r1", {
        local: [makeBranch("main", { behind: 3 }), makeBranch("develop")],
        remote: [makeRef("origin/main")],
        changes: makeChanges(["a.ts"]),
      }),
      makeRepo("r2", {
        local: [makeBranch("main", { ahead: 2 })],
        worktrees: [makeWorktree("dev/x", "/wt/x")],
      }),
    ]);

    const { container } = render(<StatusBar />);

    expect(cells(container)).toEqual([
      "2 リポジトリ",
      "ローカル 3 / リモート 1",
      "3 (1 repo)",
      "2 (1 repo)",
      "未コミット 1 repo",
      "worktree 1",
    ]);
  });

  it("読み込み中は合計を `-` にする。0 -> 途中 -> 確定と跳ねさせない", () => {
    seed([makeRepo("r1", { local: [makeBranch("main")] }), makeLoadingRepo("r2")]);

    const { container } = render(<StatusBar />);

    expect(cells(container)).toEqual([
      "2 リポジトリ",
      "ローカル - / リモート -",
      "-",
      "-",
      "未コミット -",
      "worktree -",
    ]);
  });

  it("登録が無ければ 0 リポジトリ", () => {
    seed([]);

    const { container } = render(<StatusBar />);

    expect(cells(container)[0]).toBe("0 リポジトリ");
  });

  it("読み終える前は件数も `-`。0 を挟んで 2 回跳ねさせない", () => {
    // 起動直後。まだ一覧を読んでいない
    const { container } = render(<StatusBar />);

    expect(cells(container)).toEqual([
      "- リポジトリ",
      "ローカル - / リモート -",
      "-",
      "-",
      "未コミット -",
      "worktree -",
    ]);
  });
});
