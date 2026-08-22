import { beforeEach, describe, expect, it } from "vitest";

import { consoleTabs, useConsoleStore } from "./useConsoleStore";

/*
 * コンソールのタブと出力。
 *
 * 出力があったリポジトリの分だけタブが増える (docs/specs/ui.md の「コンソール」)。
 */

const BLOCK = { lines: [{ kind: "command" as const, text: "git fetch --prune" }] };

function state() {
  return useConsoleStore.getState();
}

beforeEach(() => {
  useConsoleStore.setState({
    blocks: new Map(),
    activeTab: null,
    failed: new Set(),
    nextBlockId: 1,
  });
});

describe("コンソールのタブ", () => {
  it("出力があったリポジトリの分だけタブが増える", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r2", [BLOCK], { failed: false });

    expect(consoleTabs(state())).toEqual(["r1", "r2"]);
  });

  it("最初の出力でそのタブを開く", () => {
    state().append("r1", [BLOCK], { failed: false });

    expect(state().activeTab).toBe("r1");
  });

  it("見ているタブは新しい出力で切り替わらない", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r2", [BLOCK], { failed: false });

    expect(state().activeTab).toBe("r1");
  });

  it("出力は同じタブに積み上がる", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r1", [BLOCK], { failed: false });

    expect(state().blocks.get("r1")).toHaveLength(2);
  });

  it("ブロックの鍵は重複しない", () => {
    state().append("r1", [BLOCK, BLOCK], { failed: false });
    state().append("r1", [BLOCK], { failed: false });

    const ids = (state().blocks.get("r1") ?? []).map((block) => block.id);
    expect(new Set(ids).size).toBe(3);
  });

  // 印を立てるかどうかを決めるのは呼び出し側 (store/results.ts)。
  // 見ているタブの失敗に印を付けても消す操作が無いので、そこで落とす
  it("失敗した出力のタブに赤いドットを付ける", () => {
    state().append("r1", [BLOCK], { failed: true });

    expect(state().failed.has("r1")).toBe(true);
  });

  it("そのタブを開くとドットが消える", () => {
    state().append("r1", [BLOCK], { failed: true });
    state().append("r2", [BLOCK], { failed: false });

    state().openTab("r1");

    expect(state().activeTab).toBe("r1");
    expect(state().failed.has("r1")).toBe(false);
  });

  it("タブを閉じるとその出力も消える", () => {
    state().append("r1", [BLOCK], { failed: true });

    state().closeTab("r1");

    expect(consoleTabs(state())).toEqual([]);
    expect(state().blocks.has("r1")).toBe(false);
    expect(state().failed.has("r1")).toBe(false);
    expect(state().activeTab).toBeNull();
  });

  it("開いているタブを閉じると隣のタブに移る", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r2", [BLOCK], { failed: false });

    state().closeTab("r1");

    expect(state().activeTab).toBe("r2");
  });

  it("見ていないタブを閉じても選択は動かない", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r2", [BLOCK], { failed: false });

    state().closeTab("r2");

    expect(state().activeTab).toBe("r1");
  });

  it("末尾のタブを閉じると 1 つ前に移る", () => {
    state().append("r1", [BLOCK], { failed: false });
    state().append("r2", [BLOCK], { failed: false });
    state().openTab("r2");

    state().closeTab("r2");

    expect(state().activeTab).toBe("r1");
  });

  /** 出力の無いタブを開くと、どのタブも選ばれていない空の画面で固まる */
  it("出力の無いリポジトリのタブは開かない", () => {
    state().append("r1", [BLOCK], { failed: false });

    state().openTab("r404");

    expect(state().activeTab).toBe("r1");
  });

  it("段が無ければタブを作らない", () => {
    state().append("r1", [], { failed: false });

    expect(consoleTabs(state())).toEqual([]);
    expect(state().activeTab).toBeNull();
  });

  it("リストから削除したリポジトリのタブは消える", () => {
    state().append("r1", [BLOCK], { failed: true });
    state().append("r2", [BLOCK], { failed: false });

    state().forget("r1");

    expect(consoleTabs(state())).toEqual(["r2"]);
    expect(state().failed.has("r1")).toBe(false);
    expect(state().activeTab).toBe("r2");
  });
});
