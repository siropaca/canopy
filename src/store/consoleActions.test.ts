import { beforeEach, describe, expect, it } from "vitest";

import { isConsoleShowing, showConsoleFor, toggleConsolePanel } from "./consoleActions";
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
  useUiStore.setState({ consoleOpen: false, windowVisible: true });
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

describe("パネルを閉じるとき", () => {
  /**
   * 印を消すのは開くときだけ。**見ているタブに印が付いている状態**で
   * 確かめないと、ガードを外しても通ってしまう
   */
  it("見ているタブの印も消さない", () => {
    // 隠れている間に届いた失敗には、見ているタブでも印が付く
    useUiStore.setState({ consoleOpen: true, windowVisible: false });
    useConsoleStore.getState().append("r1", [BLOCK], { failed: true });
    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);

    toggleConsolePanel();

    expect(useUiStore.getState().consoleOpen).toBe(false);
    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);
  });
});

describe("見えているかの判定", () => {
  it("パネルが開いていて、そのタブを見ているなら見えている", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: false });
    useUiStore.setState({ consoleOpen: true });

    expect(isConsoleShowing("r1")).toBe(true);
  });

  it("パネルが閉じていれば見えていない", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: false });
    useUiStore.setState({ consoleOpen: false });

    expect(isConsoleShowing("r1")).toBe(false);
  });

  it("別のタブを見ていれば見えていない", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: false });
    useConsoleStore.getState().append("r2", [BLOCK], { failed: false });
    useUiStore.setState({ consoleOpen: true });
    useConsoleStore.getState().openTab("r1");

    expect(isConsoleShowing("r2")).toBe(false);
  });

  /**
   * ウィンドウを閉じてもプロセスは残るので、隠している間にも結果が届く
   * (docs/adr/0011-residency.md)。開いたままのコンソールを「見えている」と
   * 判定すると、戻ってきたときに失敗の印が残っていない
   */
  it("ウィンドウが隠れていれば、パネルが開いていても見えていない", () => {
    useConsoleStore.getState().append("r1", [BLOCK], { failed: false });
    useUiStore.setState({ consoleOpen: true, windowVisible: false });

    expect(isConsoleShowing("r1")).toBe(false);
  });
});
