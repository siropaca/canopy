import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { makeBranch, makePushPreview, makeRepo } from "@/test/factories";

vi.mock("@/store/opsActions");
vi.mock("@/store/bootstrap");

import * as bootstrap from "@/store/bootstrap";
import * as ops from "@/store/opsActions";

import { useRowActions } from "./useRowActions";

/*
 * **掴むのは行ではなく鍵。**
 * 開いた瞬間の `RowNode` を持ち続けると、一括フェッチが始まっても
 * 「実行中」が古いままで、無効にしたはずの項目が押せる。
 */

function rowsOf(overrides: Parameters<typeof makeRepo>[2] = {}): RowNode[] {
  const repo = makeRepo(
    "r1",
    { local: [makeBranch("main", { is_current: true }), makeBranch("side")] },
    overrides,
  );
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function branchRow(rows: RowNode[], label: string): RowNode {
  const row = rows.find((candidate) => candidate.kind === "branch" && candidate.label === label);
  if (row === undefined) throw new Error(`${label} の行が無い`);
  return row;
}

describe("メニューとダイアログが掴むもの", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("行が新しくなったら、開いているメニューも新しい行を指す", () => {
    const idle = rowsOf();
    const { result, rerender } = renderHook(({ rows }) => useRowActions(rows), {
      initialProps: { rows: idle },
    });
    act(() => {
      result.current.openMenu(branchRow(idle, "side"), { x: 1, y: 2 });
    });
    expect(result.current.menu?.row.running).toBe(false);

    // 一括フェッチが始まった
    rerender({ rows: rowsOf({ running: true }) });

    expect(result.current.menu?.row.running).toBe(true);
    expect(result.current.menu?.at).toEqual({ x: 1, y: 2 });
  });

  it("行が消えたらメニューを出さない", () => {
    const rows = rowsOf();
    const { result, rerender } = renderHook(({ rows }) => useRowActions(rows), {
      initialProps: { rows },
    });
    act(() => {
      result.current.openMenu(branchRow(rows, "side"), { x: 1, y: 2 });
    });
    expect(result.current.menu).not.toBeNull();

    rerender({ rows: [] });

    expect(result.current.menu).toBeNull();
  });

  it("開いているダイアログも新しい行を指す", () => {
    const before = rowsOf();
    const { result, rerender } = renderHook(({ rows }) => useRowActions(rows), {
      initialProps: { rows: before },
    });
    const row = branchRow(before, "main");
    if (row.kind !== "branch") throw new Error("ブランチ行ではない");
    act(() => {
      result.current.openRename(row);
    });
    expect(result.current.dialog?.row.branch.ahead).toBe(0);

    // 取り直したスナップショットで ahead が増えた
    const repo = makeRepo("r1", {
      local: [makeBranch("main", { is_current: true, ahead: 3 }), makeBranch("side")],
    });
    rerender({
      rows: flatten([repo], {
        expanded: new Set(allKeysOf([repo], ["local"])),
        query: "",
        groupDirectories: true,
        localOnly: false,
      }),
    });

    expect(result.current.dialog?.row.branch.ahead).toBe(3);
  });
});

describe("メニューの項目から操作への割り振り", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function actionsFor(rows: RowNode[]) {
    const { result } = renderHook(() => useRowActions(rows));
    return result;
  }

  it("項目ごとに違う操作を呼ぶ", () => {
    const rows = rowsOf();
    const result = actionsFor(rows);
    const repo = rows.find((row) => row.kind === "repo");
    const branch = branchRow(rows, "side");
    if (repo === undefined) throw new Error("リポジトリ行が無い");

    act(() => {
      result.current.run({ type: "pull" }, branch);
      result.current.run({ type: "checkout" }, branch);
      result.current.run({ type: "checkoutAndPull" }, branch);
      result.current.run({ type: "fetchRepo" }, repo);
      result.current.run({ type: "fetchAll" }, repo);
      result.current.run({ type: "checkoutPrevious" }, repo);
      result.current.run({ type: "reveal" }, repo);
      result.current.run({ type: "terminal" }, repo);
      result.current.run({ type: "addRepo" }, repo);
      result.current.run({ type: "removeRepo" }, repo);
      result.current.run({ type: "copy", text: "feature/a" }, repo);
    });

    expect(ops.pullRow).toHaveBeenCalledExactlyOnceWith(branch);
    expect(ops.checkoutRow).toHaveBeenCalledExactlyOnceWith(branch);
    expect(ops.checkoutAndPullRow).toHaveBeenCalledExactlyOnceWith(branch);
    expect(ops.fetchRepository).toHaveBeenCalledExactlyOnceWith("r1");
    expect(ops.fetchAllRepositories).toHaveBeenCalledOnce();
    expect(ops.checkoutPreviousBranch).toHaveBeenCalledExactlyOnceWith("r1");
    expect(ops.revealRepository).toHaveBeenCalledExactlyOnceWith("r1");
    expect(ops.openRepositoryInTerminal).toHaveBeenCalledExactlyOnceWith("r1");
    expect(bootstrap.addRepository).toHaveBeenCalledOnce();
    expect(bootstrap.removeRepository).toHaveBeenCalledExactlyOnceWith("r1");
    expect(ops.copyToClipboard).toHaveBeenCalledExactlyOnceWith("r1", "feature/a");
  });

  it("プッシュと名前の変更はダイアログを開くだけ", () => {
    const rows = rowsOf();
    const result = actionsFor(rows);
    vi.mocked(ops.loadPushPreview).mockResolvedValue(null);

    act(() => {
      result.current.run({ type: "rename" }, branchRow(rows, "side"));
    });

    expect(result.current.dialog?.kind).toBe("rename");
    expect(ops.renameBranch).not.toHaveBeenCalled();
  });

  it("ダブルクリックはチェックアウト", () => {
    const rows = rowsOf();
    const result = actionsFor(rows);
    const branch = branchRow(rows, "side");

    act(() => {
      result.current.activate(branch);
    });

    expect(ops.checkoutRow).toHaveBeenCalledExactlyOnceWith(branch);
  });

  /** 旧名と新名を入れ替えると、別のブランチの名前を変えてしまう */
  it("名前の変更は旧名 → 新名の順で渡す", () => {
    const rows = rowsOf();
    const result = actionsFor(rows);
    const row = branchRow(rows, "side");
    if (row.kind !== "branch") throw new Error("ブランチ行ではない");
    vi.mocked(ops.renameBranch).mockResolvedValue({
      kind: "ran",
      ok: true,
      steps: [],
      message: null,
    });

    act(() => {
      result.current.openRename(row);
    });
    act(() => {
      result.current.submitRename("renamed");
    });

    expect(ops.renameBranch).toHaveBeenCalledExactlyOnceWith("r1", "side", "renamed");
    expect(result.current.dialog).toBeNull();
  });

  /** lease を捨てると、強制プッシュのつもりが通常プッシュになる */
  it("プッシュは sha をそのまま渡す", () => {
    const rows = rowsOf();
    const result = actionsFor(rows);
    const row = branchRow(rows, "main");
    if (row.kind !== "branch") throw new Error("ブランチ行ではない");
    vi.mocked(ops.loadPushPreview).mockResolvedValue(makePushPreview());
    vi.mocked(ops.pushBranch).mockResolvedValue({
      kind: "ran",
      ok: true,
      steps: [],
      message: null,
    });

    act(() => {
      result.current.openPush(row);
    });
    act(() => {
      result.current.submitPush("abc1234");
    });

    expect(ops.pushBranch).toHaveBeenCalledExactlyOnceWith("r1", "main", "abc1234");
  });
});
