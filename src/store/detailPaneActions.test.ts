import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/window");

import * as ipc from "@/ipc/window";

import { toggleDetailPane } from "./detailPaneActions";
import { useToastStore } from "./useToastStore";
import { useUiStore } from "./useUiStore";

/*
 * 詳細ペインの開閉 (docs/adr/0025-hide-detail-pane.md)。
 *
 * 状態を変えて、ウィンドウの幅の下限を Rust に伝える。
 */

beforeEach(() => {
  vi.mocked(ipc).setDetailOpen.mockReset();
  vi.mocked(ipc).setDetailOpen.mockResolvedValue(undefined);
  useUiStore.setState({ detailOpen: true });
  useToastStore.setState({ toasts: [] });
});

describe("詳細ペインの開閉", () => {
  it("隠すと状態が変わり、隠したことを Rust に伝える", async () => {
    await toggleDetailPane();

    expect(useUiStore.getState().detailOpen).toBe(false);
    expect(vi.mocked(ipc).setDetailOpen.mock.calls).toEqual([[false]]);
  });

  it("もう一度押すと表示に戻り、表示したことを伝える", async () => {
    await toggleDetailPane();
    await toggleDetailPane();

    expect(useUiStore.getState().detailOpen).toBe(true);
    expect(vi.mocked(ipc).setDetailOpen.mock.calls).toEqual([[false], [true]]);
  });

  /**
   * 握りつぶさない。幅が戻らないまま黙っていると、潰れた詳細ペインの理由が分からない。
   * **開閉は戻さない。** 見えている状態と保存する状態が食い違う
   */
  it("ウィンドウの幅を変えられなかったらトーストに出す。開閉は戻さない", async () => {
    vi.mocked(ipc).setDetailOpen.mockRejectedValue("ウィンドウの幅を変えられません: boom");

    await toggleDetailPane();

    expect(useToastStore.getState().toasts.map((toast) => [toast.kind, toast.text])).toEqual([
      ["failure", "ウィンドウの幅を変えられません: boom"],
    ]);
    expect(useUiStore.getState().detailOpen).toBe(false);
  });

  /**
   * Tauri の async コマンドは呼び出しごとに並行に走る。続けて押すと後の要求が
   * 先に効いて、隠しているのに下限が 720px のまま残ることがある (docs/pitfalls.md)
   */
  it("前の要求が終わるまで次の要求を送らない", async () => {
    let finishFirst: () => void = () => undefined;
    vi.mocked(ipc).setDetailOpen.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const first = toggleDetailPane();
    const second = toggleDetailPane();
    await Promise.resolve();

    expect(vi.mocked(ipc).setDetailOpen.mock.calls).toEqual([[false]]);
    expect(useUiStore.getState().detailOpen).toBe(true);

    finishFirst();
    await Promise.all([first, second]);

    expect(vi.mocked(ipc).setDetailOpen.mock.calls).toEqual([[false], [true]]);
  });

  /** 1 回失敗しても、後の要求は止めない */
  it("前の要求が失敗しても次の要求を送る", async () => {
    vi.mocked(ipc).setDetailOpen.mockRejectedValueOnce("boom");

    await Promise.all([toggleDetailPane(), toggleDetailPane()]);

    expect(vi.mocked(ipc).setDetailOpen.mock.calls).toEqual([[false], [true]]);
  });
});
