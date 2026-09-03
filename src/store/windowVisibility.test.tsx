import { beforeEach, describe, expect, it } from "vitest";

import { watchWindowVisibility } from "./events";
import { useConsoleStore } from "./useConsoleStore";
import { useUiStore } from "./useUiStore";

/*
 * ウィンドウが画面に出ているかを追う。
 *
 * 閉じてもプロセスは残るので、隠している間にも結果が届く
 * (docs/adr/0011-residency.md)。**`visibilitychange` を使う。**
 * Rust から送ると、こちらが `hide()` した経路しか拾えない。
 *
 * DOM の API を使うのでこのファイルだけ `.tsx` に置いている (vite.config.ts)。
 */

const BLOCK = { lines: [{ kind: "command" as const, text: "git fetch --prune" }] };

/** jsdom の `visibilityState` は読み取り専用なので差し替える */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  useConsoleStore.setState({
    blocks: new Map(),
    activeTab: null,
    failed: new Set(),
    nextBlockId: 1,
  });
  setVisibility("visible");
  useUiStore.setState({ windowVisible: true, consoleOpen: false });
});

describe("ウィンドウの可視性", () => {
  it("画面から消えたら false、戻ったら true", () => {
    const stop = watchWindowVisibility();

    setVisibility("hidden");
    expect(useUiStore.getState().windowVisible).toBe(false);

    setVisibility("visible");
    expect(useUiStore.getState().windowVisible).toBe(true);

    stop();
  });

  it("張った時点の状態から始める", () => {
    setVisibility("hidden");
    useUiStore.setState({ windowVisible: true });

    const stop = watchWindowVisibility();

    expect(useUiStore.getState().windowVisible).toBe(false);
    stop();
  });

  it("外すと追わなくなる", () => {
    const stop = watchWindowVisibility();

    stop();
    setVisibility("hidden");

    expect(useUiStore.getState().windowVisible).toBe(true);
  });

  /**
   * 隠している間に届いた失敗には印が付くが、戻ってきた時点でその出力は見えている。
   * パネルを開いたときと同じ扱い (docs/specs/ui.md の「コンソール」)
   */
  it("戻ったら、見えているタブの赤いドットを消す", () => {
    useUiStore.setState({ consoleOpen: true });
    const stop = watchWindowVisibility();
    setVisibility("hidden");
    // 隠れている間に失敗が届く
    useConsoleStore.getState().append("r1", [BLOCK], { failed: true });
    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);

    setVisibility("visible");

    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
    stop();
  });

  it("コンソールを閉じているなら、戻っても印は消さない", () => {
    useUiStore.setState({ consoleOpen: false });
    const stop = watchWindowVisibility();
    setVisibility("hidden");
    useConsoleStore.getState().append("r1", [BLOCK], { failed: true });

    setVisibility("visible");

    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);
    stop();
  });
});
