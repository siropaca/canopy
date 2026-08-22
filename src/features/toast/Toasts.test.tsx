import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConsoleStore } from "@/store/useConsoleStore";
import { useToastStore } from "@/store/useToastStore";
import { useUiStore } from "@/store/useUiStore";

import { Toasts } from "./Toasts";

/*
 * トースト。見え方は docs/specs/ui.md の「トースト」。
 */

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.getState().clear();
  useConsoleStore.setState({
    blocks: new Map([["r1", [{ id: "b1", lines: [{ kind: "error", text: "error: ..." }] }]]]),
    activeTab: null,
    failed: new Set(["r1"]),
    nextBlockId: 2,
  });
  useUiStore.setState({ consoleOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("トースト", () => {
  it("実行したコマンドとリポジトリ名を出す", () => {
    useToastStore.getState().push({
      kind: "success",
      text: "git fetch --prune",
      repoName: "acme-api",
      command: true,
    });

    render(<Toasts />);

    expect(screen.getByText("acme-api")).toBeDefined();
    expect(screen.getByText("git fetch --prune").tagName).toBe("CODE");
  });

  it("コマンドでない文言は等幅にしない", () => {
    useToastStore.getState().push({ kind: "success", text: "コピーしました: topic" });

    render(<Toasts />);

    expect(screen.getByText("コピーしました: topic").tagName).not.toBe("CODE");
  });

  it("成功と失敗でアイコンを変える", () => {
    useToastStore.getState().push({ kind: "success", text: "成功" });
    useToastStore.getState().push({ kind: "failure", text: "失敗" });

    render(<Toasts />);

    expect(screen.getByText("i")).toBeDefined();
    expect(screen.getByText("!")).toBeDefined();
  });

  it("新しいトーストを上に積む", () => {
    useToastStore.getState().push({ kind: "success", text: "1 件目" });
    useToastStore.getState().push({ kind: "success", text: "2 件目" });

    const { container } = render(<Toasts />);

    expect(container.textContent?.indexOf("2 件目")).toBeLessThan(
      container.textContent?.indexOf("1 件目") ?? -1,
    );
  });

  it("失敗の 詳細を見る でそのリポジトリのコンソールが開く", () => {
    useToastStore.getState().push({
      kind: "failure",
      text: "プルに失敗しました",
      repoName: "acme-api",
      detailRepoId: "r1",
    });

    render(<Toasts />);
    fireEvent.click(screen.getByText("詳細を見る"));

    expect(useUiStore.getState().consoleOpen).toBe(true);
    expect(useConsoleStore.getState().activeTab).toBe("r1");
    // タブを開いたので赤いドットは消える
    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
  });

  it("コンソールに出す段が無い失敗には導線を出さない", () => {
    // 空のタブへ飛ばさない (docs/specs/ui.md の「トースト」)
    useToastStore.getState().push({ kind: "failure", text: "クリップボードに書けませんでした" });

    render(<Toasts />);

    expect(screen.queryByText("詳細を見る")).toBeNull();
  });

  it("時間が経つと消える", () => {
    useToastStore.getState().push({ kind: "success", text: "git fetch --prune" });

    render(<Toasts />);
    expect(screen.getByText("git fetch --prune")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText("git fetch --prune")).toBeNull();
  });
});
