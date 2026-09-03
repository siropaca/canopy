import { beforeEach, describe, expect, it } from "vitest";

import { CONSOLE_BLOCK_LIMIT, ELIDED_ID } from "@/shared/lib/consoleLog";

import { consoleTabs, createConsoleStore, useConsoleStore } from "./useConsoleStore";

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

describe("出力の上限", () => {
  /**
   * タブを閉じるまで積み上がると、長く使うほど重くなる。
   * **黙って捨てず**に、落とした件数を先頭のブロックで伝える
   * (docs/specs/ui.md の「コンソール」)
   */
  it("上限を超えたら古い方から落として、印を 1 つ残す", () => {
    const store = createConsoleStore();
    for (let index = 0; index < CONSOLE_BLOCK_LIMIT + 10; index += 1) {
      store.getState().append("r1", [{ lines: [{ kind: "command", text: `git ${index}` }] }], {
        failed: false,
      });
    }

    const blocks = store.getState().blocks.get("r1") ?? [];

    expect(blocks).toHaveLength(CONSOLE_BLOCK_LIMIT);
    expect(blocks[0]?.id).toBe(ELIDED_ID);
    expect(blocks[0]?.lines[0]?.text).toBe("古い出力 11 件を省略しました");
    // 残っているのは新しい方
    expect(blocks.at(-1)?.lines[0]?.text).toBe(`git ${CONSOLE_BLOCK_LIMIT + 9}`);
  });

  it("上限までは何も落とさない", () => {
    const store = createConsoleStore();
    for (let index = 0; index < CONSOLE_BLOCK_LIMIT; index += 1) {
      store.getState().append("r1", [{ lines: [{ kind: "command", text: `git ${index}` }] }], {
        failed: false,
      });
    }

    const blocks = store.getState().blocks.get("r1") ?? [];

    expect(blocks).toHaveLength(CONSOLE_BLOCK_LIMIT);
    expect(blocks.every((block) => block.id !== ELIDED_ID)).toBe(true);
  });
});
