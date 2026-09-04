import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/repos");

import * as repos from "@/ipc/repos";

import { resetRequests } from "./bootstrap";
import { watchWindowVisibility } from "./events";
import { useConsoleStore } from "./useConsoleStore";
import { useRepoStore } from "./useRepoStore";
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

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

beforeEach(() => {
  vi.mocked(repos).getRepoSnapshot.mockReset();
  vi.mocked(repos).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 4 }));
  resetRequests();
  useRepoStore.setState({
    byId: new Map(),
    order: [],
    loaded: false,
    loadError: null,
    running: new Map(),
  });
  useRepoStore
    .getState()
    .registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);
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

/*
 * 前面に戻ったら取り直す (docs/adr/0022-auto-refresh.md)。
 *
 * 隠れている間にターミナルで動かした結果を映す。
 */
describe("前面に戻ったときの取り直し", () => {
  it("隠れてから戻ったら全リポジトリを取り直す", async () => {
    const stop = watchWindowVisibility();

    setVisibility("hidden");
    setVisibility("visible");

    await vi.waitFor(() => {
      expect(
        vi
          .mocked(repos)
          .getRepoSnapshot.mock.calls.map(([id]) => id)
          .sort(),
      ).toEqual(["r1", "r2"]);
    });
    stop();
  });

  /** 起動直後は `loadEverything` が全件読んでいる。二重に読まない */
  it("張った時点では取り直さない", () => {
    const stop = watchWindowVisibility();

    expect(vi.mocked(repos).getRepoSnapshot).not.toHaveBeenCalled();
    stop();
  });

  it("隠れただけでは取り直さない", () => {
    const stop = watchWindowVisibility();

    setVisibility("hidden");

    expect(vi.mocked(repos).getRepoSnapshot).not.toHaveBeenCalled();
    stop();
  });

  /** 外したあとに戻しても動かない */
  it("外したら取り直さない", () => {
    const stop = watchWindowVisibility();
    setVisibility("hidden");
    stop();

    setVisibility("visible");

    expect(vi.mocked(repos).getRepoSnapshot).not.toHaveBeenCalled();
  });
});
