import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltip } from "./Tooltip";

/*
 * サイドバーのツールチップ。
 *
 * 見え方と位置はモック (docs/mock/tree.tmpl.html の `.tip`)。
 * 遅延は 500ms (docs/plans/phase-4-polish.md)。
 */

/** 吹き出しの高さ。jsdom はレイアウトを持たないので測れず、実測に近い値を返させる */
const TIP_HEIGHT = 20;

/** ホバーしたボタンの位置。寸法は 30x30 (Sidebar.module.css) */
const BOX = { x: 6, y: 100, left: 6, top: 100, right: 36, bottom: 130, width: 30, height: 30 };

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
if (offsetHeight === undefined) throw new Error("jsdom が offsetHeight を持たない");

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => TIP_HEIGHT,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
});

/** ボタンを 1 つ包んで描く。返すのはホバーを受ける外側の要素 */
function renderTooltip({ label = "フェッチ", disabled = false } = {}): HTMLElement {
  const { container } = render(
    <Tooltip label={label}>
      <button type="button" disabled={disabled}>
        アイコン
      </button>
    </Tooltip>,
  );
  const anchor = container.firstElementChild;
  if (!(anchor instanceof HTMLElement)) throw new Error("ホバーを受ける要素が無い");
  Object.defineProperty(anchor, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...BOX, toJSON: () => BOX }),
  });
  return anchor;
}

function hover(anchor: HTMLElement, ms: number): void {
  fireEvent.mouseEnter(anchor);
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("ツールチップ", () => {
  it("ホバーしても 500ms 経つまでは出ない", () => {
    const anchor = renderTooltip();

    hover(anchor, 499);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ホバーしてから 500ms 経つと機能名を出す", () => {
    const anchor = renderTooltip();

    hover(anchor, 500);

    expect(screen.getByRole("tooltip").textContent).toBe("フェッチ");
  });

  it("ホバーを外すと即座に消える", () => {
    const anchor = renderTooltip();
    hover(anchor, 500);

    fireEvent.mouseLeave(anchor);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("出る前にホバーを外したら、あとから出てこない", () => {
    const anchor = renderTooltip();
    hover(anchor, 300);

    fireEvent.mouseLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  /** モックの `.tip` と同じ置き方 (`r.right + 6` と縦中央) */
  it("ボタンの右 6px の、縦中央に置く", () => {
    const anchor = renderTooltip();

    hover(anchor, 500);

    const tip = screen.getByRole("tooltip");
    expect(tip.style.getPropertyValue("--tip-left")).toBe("42px");
    expect(tip.style.getPropertyValue("--tip-top")).toBe("105px");
  });

  /**
   * 無効なボタンはマウスイベントを出さないので、ホバーは外側で受ける。
   * ツールチップの有無は有効・無効で変えない (docs/specs/ui.md の「サイドバー」)
   */
  it("無効なボタンでも出る", () => {
    const anchor = renderTooltip({ disabled: true });

    hover(anchor, 500);

    expect(screen.getByRole("tooltip").textContent).toBe("フェッチ");
  });
});
