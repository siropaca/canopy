import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "@/store/useUiStore";

import { SearchBar } from "./SearchBar";
import { SEARCH_DEBOUNCE_MS } from "./useSearchQuery";

/*
 * 検索欄。ツリー領域の最上部に固定する (docs/specs/ui.md の「検索」)。
 *
 * **1 文字打つごとに全 ref をツリー化する**ので、ストアへ渡すのを遅らせる
 * (docs/plans/phase-3-around.md の完了条件)。
 */

function input(): HTMLInputElement {
  const found = screen.getByPlaceholderText("ブランチまたはタグ");
  if (!(found instanceof HTMLInputElement)) throw new Error("入力欄ではない");
  return found;
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useUiStore.setState({ query: "" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("検索欄", () => {
  /** 打鍵ごとに全 ref をツリー化するので、遅らせる幅は決め打ちにしておく */
  it("絞り込みを遅らせる幅が決まっている", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(120);
  });

  it("打った文字はすぐ見える", () => {
    render(<SearchBar />);

    type("rec");

    expect(input().value).toBe("rec");
  });

  it("打った直後はまだ絞り込まない", () => {
    render(<SearchBar />);

    type("rec");
    tick(SEARCH_DEBOUNCE_MS - 1);

    expect(useUiStore.getState().query).toBe("");
  });

  it("入力が止まったら絞り込む", () => {
    render(<SearchBar />);

    type("rec");
    tick(SEARCH_DEBOUNCE_MS);

    expect(useUiStore.getState().query).toBe("rec");
  });

  it("続けて打っている間は最後の 1 回だけ反映する", () => {
    render(<SearchBar />);

    type("r");
    tick(SEARCH_DEBOUNCE_MS - 1);
    type("re");
    tick(SEARCH_DEBOUNCE_MS - 1);
    type("rec");
    expect(useUiStore.getState().query).toBe("");

    tick(SEARCH_DEBOUNCE_MS);

    expect(useUiStore.getState().query).toBe("rec");
  });

  it("消すと検索が解ける", () => {
    render(<SearchBar />);
    type("rec");
    tick(SEARCH_DEBOUNCE_MS);

    type("");
    tick(SEARCH_DEBOUNCE_MS);

    expect(useUiStore.getState().query).toBe("");
  });

  /** クリアや復元で外から変わったときに、入力欄だけ古い語が残らないようにする */
  it("外から検索語が変わったら入力欄も合わせる", () => {
    render(<SearchBar />);
    type("rec");
    tick(SEARCH_DEBOUNCE_MS);

    act(() => {
      useUiStore.getState().setQuery("");
    });

    expect(input().value).toBe("");
  });

  it("保存してあった状態から開いても、いまの検索語を出す", () => {
    useUiStore.setState({ query: "main" });

    render(<SearchBar />);

    expect(input().value).toBe("main");
  });
});
