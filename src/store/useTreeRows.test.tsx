import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { RowNode } from "@/ipc/types";
import { makeBranch, makeRef, makeRepo } from "@/test/factories";

import { useTreeRows } from "./useTreeRows";
import { useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

/** フックの結果を取り出すだけの器 */
function Probe({ onRows }: { onRows: (rows: RowNode[]) => void }) {
  onRows(useTreeRows());
  return null;
}

function rowsFromHook(): RowNode[] {
  let captured: RowNode[] = [];
  render(
    <Probe
      onRows={(rows) => {
        captured = rows;
      }}
    />,
  );
  return captured;
}

describe("useTreeRows", () => {
  beforeEach(() => {
    const repo = makeRepo("r1", {
      local: [makeBranch("main")],
      remote: [makeRef("origin/main")],
    });
    useRepoStore.setState({
      byId: new Map([["r1", repo]]),
      order: ["r1"],
      loaded: true,
      loadError: null,
    });
    useUiStore.getState().setExpanded([]);
    useUiStore.getState().setQuery("");
  });

  it("2 つのストアから行を組み立てる", () => {
    expect(rowsFromHook().map((row) => row.kind)).toEqual(["repo"]);
  });

  it("開いている鍵を反映する", () => {
    useUiStore.getState().setExpanded(["r1|repo|", "r1|local|"]);

    // ローカルの中身が出て、リモートの括りは閉じたまま並ぶ
    expect(rowsFromHook().map((row) => row.kind)).toEqual(["repo", "section", "branch", "section"]);
  });

  it("検索を反映する", () => {
    useUiStore.getState().setQuery("origin");

    expect(rowsFromHook().map((row) => row.kind)).toEqual([
      "repo",
      "section",
      "directory",
      "remote",
    ]);
  });

  it("同じ入力なら同じ配列を返す (仮想リストが並びの変化を見分けられる)", () => {
    const first = rowsFromHook();
    const second = rowsFromHook();

    expect(first).not.toBe(second);
    expect(first.map((row) => row.key)).toEqual(second.map((row) => row.key));
  });
});
