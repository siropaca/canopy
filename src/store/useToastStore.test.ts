import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAILURE_MS, MAX_TOASTS, SUCCESS_MS, useToastStore } from "./useToastStore";

/*
 * トースト。表示時間と件数の上限は docs/specs/ui.md の「トースト」。
 */

function state() {
  return useToastStore.getState();
}

function texts() {
  return state().toasts.map((toast) => toast.text);
}

beforeEach(() => {
  vi.useFakeTimers();
  state().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("トースト", () => {
  /** 値の出どころは docs/specs/ui.md の「トースト」。定数だけ書き換えても気づけるようにする */
  it("表示時間と上限が仕様どおり", () => {
    expect(SUCCESS_MS).toBe(4000);
    expect(FAILURE_MS).toBe(9000);
    expect(MAX_TOASTS).toBe(6);
  });

  it("新しいものが先頭に積まれる", () => {
    state().push({ kind: "success", text: "git fetch --prune" });
    state().push({ kind: "success", text: "git pull --rebase" });

    expect(texts()).toEqual(["git pull --rebase", "git fetch --prune"]);
  });

  it("成功は 4 秒で消える", () => {
    state().push({ kind: "success", text: "git fetch --prune" });

    vi.advanceTimersByTime(SUCCESS_MS - 1);
    expect(texts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(texts()).toHaveLength(0);
  });

  it("失敗は 9 秒残る", () => {
    state().push({ kind: "failure", text: "プルに失敗しました" });

    vi.advanceTimersByTime(SUCCESS_MS);
    expect(texts()).toHaveLength(1);

    vi.advanceTimersByTime(FAILURE_MS - SUCCESS_MS);
    expect(texts()).toHaveLength(0);
  });

  it("上限を超えると古いものから押し出される", () => {
    for (let index = 0; index <= MAX_TOASTS; index += 1) {
      state().push({ kind: "success", text: `t${index}` });
    }

    expect(texts()).toHaveLength(MAX_TOASTS);
    expect(texts().at(-1)).toBe("t1");
    expect(texts()).not.toContain("t0");
  });

  it("押し出されたトーストのタイマーを残さない", () => {
    // 押し出した分の setTimeout を止めないと、消えたトーストのぶんだけ
    // 締め切りが積み上がる。件数では見えないのでタイマーの本数で見る
    for (let index = 0; index <= MAX_TOASTS * 2; index += 1) {
      state().push({ kind: "failure", text: `t${index}` });
    }

    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
  });

  it("閉じると消えて、締め切りのタイマーも止まる", () => {
    state().push({ kind: "failure", text: "プルに失敗しました" });
    const id = state().toasts[0]?.id ?? "";

    state().dismiss(id);

    expect(texts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("閉じたトーストのタイマーが後から発火しても他の件を消さない", () => {
    state().push({ kind: "success", text: "1 件目" });
    const id = state().toasts[0]?.id ?? "";
    vi.advanceTimersByTime(SUCCESS_MS / 2);
    state().dismiss(id);
    state().push({ kind: "success", text: "2 件目" });

    // 1 件目の締め切りを越えても、2 件目は自分の 4 秒を持っている
    vi.advanceTimersByTime(SUCCESS_MS / 2);

    expect(texts()).toEqual(["2 件目"]);
  });
});
