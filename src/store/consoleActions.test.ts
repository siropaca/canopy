import { beforeEach, describe, expect, it } from "vitest";

import { showConsoleFor, toggleConsolePanel } from "./consoleActions";
import { useConsoleStore } from "./useConsoleStore";
import { useUiStore } from "./useUiStore";

/*
 * コンソールを開く操作。パネルの開閉 (UI ストア) とタブ (コンソールストア) を
 * またぐので、まとめてここに置く。
 */

const BLOCK = { lines: [{ kind: "command" as const, text: "git fetch --prune" }] };

beforeEach(() => {
  useConsoleStore.setState({
    blocks: new Map(),
    activeTab: null,
    failed: new Set(),
    nextBlockId: 1,
  });
  useUiStore.setState({ consoleOpen: false });
});

describe("コンソールを開く", () => {
  it("トーストの 詳細を見る は、そのリポジトリのタブで開く", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: true });
    useConsoleStore.getState().append("r2", [BLOCK], { failed: true });

    showConsoleFor("r2");

    expect(useUiStore.getState().consoleOpen).toBe(true);
    expect(useConsoleStore.getState().activeTab).toBe("r2");
    expect(useConsoleStore.getState().failed.has("r2")).toBe(false);
    // 見ていないタブの印は残る
    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);
  });

  it("パネルを開いたら、見えているタブの赤いドットは消える", () => {
    // 閉じている間に届いた失敗には印が付く。開いた時点で中身は見えている
    useConsoleStore.getState().append("r1", [BLOCK], { failed: true });

    toggleConsolePanel();

    expect(useUiStore.getState().consoleOpen).toBe(true);
    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
  });

  it("閉じるときは印を触らない", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: false });
    useConsoleStore.getState().append("r2", [BLOCK], { failed: true });
    toggleConsolePanel();

    toggleConsolePanel();

    expect(useUiStore.getState().consoleOpen).toBe(false);
    expect(useConsoleStore.getState().failed.has("r2")).toBe(true);
  });
});
