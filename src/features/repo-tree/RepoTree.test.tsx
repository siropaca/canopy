import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { makeRepo } from "@/test/factories";
import { useRepoStore } from "@/store/useRepoStore";

import { RepoTree } from "./RepoTree";

/*
 * ツリー領域の 3 状態 (docs/specs/ui.md の「読み込み中とエラー」)。
 * 行そのものの描画は TreeRow.test.tsx で見ている。
 */

function rowsOfOneRepo(): RowNode[] {
  const repo = makeRepo("r1");
  return flatten([repo], {
    expanded: new Set<string>(),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

describe("ツリー領域", () => {
  beforeEach(() => {
    useRepoStore.setState({ byId: new Map(), order: [], loaded: false, loadError: null });
  });

  it("読み終える前は何も出さない。「登録されていません」を一瞬出さない", () => {
    const { container } = render(<RepoTree rows={[]} />);

    expect(container.textContent).toBe("");
  });

  it("登録が 0 件なら、その旨を出す", () => {
    useRepoStore.setState({ byId: new Map(), order: [], loaded: true, loadError: null });

    render(<RepoTree rows={[]} />);

    expect(screen.getByText("リポジトリが登録されていません")).toBeDefined();
  });

  it("設定が読めなかったら理由を出す。握りつぶさない", () => {
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: true,
      loadError: "設定の中身が壊れています (canopy.json)",
    });

    render(<RepoTree rows={rowsOfOneRepo()} />);

    expect(screen.getByText("設定の中身が壊れています (canopy.json)")).toBeDefined();
  });
});
