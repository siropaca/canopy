import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { RepoState } from "@/ipc/types";
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

/** 表示を「セルごとの文字」で読む */
function cells(container: HTMLElement): string[] {
  return [...(container.firstElementChild?.children ?? [])].map((cell) => cell.textContent ?? "");
}

describe("ステータスバー", () => {
  beforeEach(() => {
    useRepoStore.setState({ byId: new Map(), order: [], loaded: false, loadError: null });
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
