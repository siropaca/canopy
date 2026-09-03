import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * ドラッグ中の再描画。
 *
 * スプリッタは pointermove ごとに幅を配る。**その値を `App` が購読していると、
 * 画面全体が 1 移動ごとに作り直される** (docs/plans/phase-4-polish.md)。
 * 幅を使うのはツリーペインだけなので、他の部分は動かないことを縛る。
 */

vi.mock("@/store/bootstrap");
vi.mock("@/store/events");
vi.mock("@/store/persist");

// 再描画の回数を数える差し替え。中身は空でよい
const renders = { detail: 0, statusBar: 0, sidebar: 0 };

vi.mock("@/features/detail/DetailPane", () => ({
  DetailPane: () => {
    renders.detail += 1;
    return <div data-testid="detail" />;
  },
}));
vi.mock("@/features/status-bar/StatusBar", () => ({
  StatusBar: () => {
    renders.statusBar += 1;
    return <div data-testid="status-bar" />;
  },
}));
vi.mock("@/features/sidebar/Sidebar", () => ({
  Sidebar: () => {
    renders.sidebar += 1;
    return <div data-testid="sidebar" />;
  },
}));
vi.mock("@/features/repo-tree/RepoTree", () => ({
  RepoTree: () => <div data-testid="tree" />,
  TreePane: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-testid="tree-pane">{children}</div>
  ),
}));

import * as bootstrap from "@/store/bootstrap";
import * as events from "@/store/events";
import { MIN_PANE_WIDTH, useUiStore } from "@/store/useUiStore";

import { App } from "./App";

/** **`act` で囲む。** 囲まないと React が再描画を流さず、数えた回数が実際とずれる */
function send(element: HTMLElement, type: string, clientX: number): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, button: 0, pointerId: 1 }),
    );
  });
}

/** スプリッタを描いて掴めるようにする */
function renderApp(): HTMLElement {
  const { container } = render(<App />);
  const splitter = container.querySelector("[role=separator]");
  if (!(splitter instanceof HTMLElement)) throw new Error("スプリッタが描かれていない");
  grab(splitter);
  return splitter;
}

/** jsdom は setPointerCapture を持っていない */
function grab(element: HTMLElement): void {
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  element.hasPointerCapture = () => true;
}

beforeEach(() => {
  renders.detail = 0;
  renders.statusBar = 0;
  renders.sidebar = 0;
  vi.mocked(bootstrap.loadEverything).mockResolvedValue(undefined);
  vi.mocked(events.listenForRepoUpdates).mockResolvedValue(vi.fn());
  vi.mocked(events.watchWindowVisibility).mockReturnValue(vi.fn());
  useUiStore.setState({ paneWidth: 360 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("スプリッタのドラッグ中の再描画", () => {
  it("幅を配っても、幅を使わない部分は作り直さない", () => {
    const splitter = renderApp();
    const before = { ...renders };

    send(splitter, "pointerdown", 400);
    for (let x = 401; x <= 410; x += 1) {
      send(splitter, "pointermove", x);
    }
    send(splitter, "pointerup", 410);

    // 幅は届いている
    expect(useUiStore.getState().paneWidth).toBe(370);
    // 10 回動かしても、幅を使わない部分は 1 度も作り直さない
    expect(renders.detail - before.detail).toBe(0);
    expect(renders.statusBar - before.statusBar).toBe(0);
    expect(renders.sidebar - before.sidebar).toBe(0);
    // ツリーペインは差し替えてあるので、ここでは数えない。
    // 本物は自分で幅を購読していて、CSS 変数に流し込む (features/repo-tree/RepoTree.tsx)
  });

  /** 掴んだ時点の幅を見ないと、2 回目以降のドラッグで飛ぶ */
  it("2 回続けて掴んでも、その時点の幅から動かす", () => {
    const splitter = renderApp();

    send(splitter, "pointerdown", 400);
    send(splitter, "pointermove", 440);
    send(splitter, "pointerup", 440);
    expect(useUiStore.getState().paneWidth).toBe(400);

    send(splitter, "pointerdown", 100);
    send(splitter, "pointermove", 140);
    send(splitter, "pointerup", 140);

    expect(useUiStore.getState().paneWidth).toBe(440);
  });

  it("範囲の下限より狭くはならない", () => {
    const splitter = renderApp();

    send(splitter, "pointerdown", 400);
    send(splitter, "pointermove", 0);

    expect(useUiStore.getState().paneWidth).toBe(MIN_PANE_WIDTH);
  });
});
