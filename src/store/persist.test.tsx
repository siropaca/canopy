import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ipc/repos");

import * as ipc from "@/ipc/repos";

import { SAVE_DEBOUNCE_MS, usePersistUiState } from "./persist";
import { useRepoStore } from "./useRepoStore";
import { useToastStore } from "./useToastStore";
import { useUiStore } from "./useUiStore";

function Persisting({ enabled = true }: { enabled?: boolean }) {
  usePersistUiState(enabled);
  return null;
}

describe("UI 状態の保存", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ipc).saveUiState.mockReset();
    vi.mocked(ipc).saveUiState.mockResolvedValue(undefined);
    useRepoStore.setState({ byId: new Map(), order: [], loaded: false, loadError: null });
    useUiStore.getState().setExpanded([]);
    useUiStore.getState().setPaneWidth(360);
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("変更をまとめて 1 回だけ書く", () => {
    render(<Persisting />);

    act(() => {
      useUiStore.getState().toggleExpanded("r1|repo|");
      useUiStore.getState().toggleExpanded("r1|local|");
      useUiStore.getState().setPaneWidth(400);
    });
    expect(vi.mocked(ipc).saveUiState).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(vi.mocked(ipc).saveUiState).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ipc).saveUiState).toHaveBeenCalledWith(
      expect.objectContaining({
        expanded: ["r1|local|", "r1|repo|"],
        pane_width: 400,
      }),
    );
  });

  /** 黙って落とすと、再起動して並び順が戻ってから気づくことになる */
  it("保存に失敗したらトーストで知らせる", async () => {
    vi.mocked(ipc).saveUiState.mockRejectedValue("設定を保存できませんでした (canopy.json)");
    render(<Persisting />);

    act(() => {
      useUiStore.getState().setPaneWidth(400);
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      kind: "failure",
      text: "設定を保存できませんでした (canopy.json)",
    });
  });

  it("保存する形が変わっていなければ書かない", () => {
    render(<Persisting />);

    act(() => {
      useUiStore.getState().select("r1|repo|");
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    // 選択は保存しない項目なので、書く必要が無い
    expect(vi.mocked(ipc).saveUiState).not.toHaveBeenCalled();
  });

  it("読み込みが終わるまでは書かない", () => {
    render(<Persisting enabled={false} />);

    act(() => {
      useUiStore.getState().toggleExpanded("r1|repo|");
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(vi.mocked(ipc).saveUiState).not.toHaveBeenCalled();
  });

  it("設定が読めていないときは書かない。壊れたファイルを上書きしない", () => {
    render(<Persisting />);

    act(() => {
      useRepoStore.getState().setLoadError("設定の中身が壊れています");
      useUiStore.getState().toggleExpanded("r1|repo|");
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(vi.mocked(ipc).saveUiState).not.toHaveBeenCalled();
  });

  it("片付けのときに保留分を書く。閉じる直前の変更を落とさない", () => {
    const { unmount } = render(<Persisting />);

    act(() => {
      useUiStore.getState().toggleExpanded("r1|repo|");
    });
    expect(vi.mocked(ipc).saveUiState).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(vi.mocked(ipc).saveUiState).toHaveBeenCalledWith(
      expect.objectContaining({ expanded: ["r1|repo|"] }),
    );
  });

  it("並び順の変更も保存する", () => {
    render(<Persisting />);

    act(() => {
      useRepoStore.getState().registerAll([
        { id: "r1", name: "a", path: "/a" },
        { id: "r2", name: "b", path: "/b" },
      ]);
      useRepoStore.getState().setOrder(["r2", "r1"]);
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });

    expect(vi.mocked(ipc).saveUiState).toHaveBeenCalledWith(
      expect.objectContaining({ repo_order: ["r2", "r1"] }),
    );
  });
});
