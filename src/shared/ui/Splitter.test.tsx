import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Splitter } from "./Splitter";

/** jsdom は setPointerCapture を持っていないので、掴む部分だけ差し替える */
function renderSplitter(width = 360) {
  const onWidth = vi.fn();
  const { container } = render(<Splitter width={width} onWidth={onWidth} />);
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("スプリッタが描かれていない");
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  element.hasPointerCapture = () => true;
  return { element, onWidth };
}

function pointer(type: string, clientX: number, button = 0): PointerEvent {
  return new PointerEvent(type, { bubbles: true, clientX, button, pointerId: 1 });
}

describe("スプリッタ", () => {
  it("押してすぐ動かした分も取りこぼさない", () => {
    const { element, onWidth } = renderSplitter(360);

    element.dispatchEvent(pointer("pointerdown", 400));
    element.dispatchEvent(pointer("pointermove", 460));

    // 再描画を待たずに 1 回目の移動が届く
    expect(onWidth).toHaveBeenCalledWith(420);
  });

  it("動かした差分を足した幅を渡す。丸めは呼び出し側", () => {
    const { element, onWidth } = renderSplitter(360);

    element.dispatchEvent(pointer("pointerdown", 400));
    element.dispatchEvent(pointer("pointermove", 300));

    expect(onWidth).toHaveBeenCalledWith(260);
  });

  it("押していないときの移動では何もしない", () => {
    const { element, onWidth } = renderSplitter();

    element.dispatchEvent(pointer("pointermove", 500));

    expect(onWidth).not.toHaveBeenCalled();
  });

  it("離したあとの移動では何もしない", () => {
    const { element, onWidth } = renderSplitter();
    element.dispatchEvent(pointer("pointerdown", 400));
    element.dispatchEvent(pointer("pointerup", 460));
    onWidth.mockClear();

    element.dispatchEvent(pointer("pointermove", 500));

    expect(onWidth).not.toHaveBeenCalled();
  });

  it("右ボタンでは掴まない", () => {
    const { element, onWidth } = renderSplitter();

    element.dispatchEvent(pointer("pointerdown", 400, 2));
    element.dispatchEvent(pointer("pointermove", 460));

    expect(onWidth).not.toHaveBeenCalled();
  });
});
