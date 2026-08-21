import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "./Dialog";

/*
 * 共通の枠の振る舞い (docs/specs/ui.md の「ダイアログ」)。
 * **Enter と Esc を受けるのはダイアログの中だけ** (docs/adr/0008-no-keyboard-shortcuts.md)。
 */

function renderDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const props = {
    title: "ブランチ main の名前変更",
    confirmLabel: "名前の変更",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    children: <input aria-label="ブランチ名" />,
    ...overrides,
  };
  render(<Dialog {...props} />);
  return props;
}

describe("ダイアログの枠", () => {
  it("タイトルに対象名を含める。ボタンは キャンセル → 操作名 の順", () => {
    renderDialog();

    const buttons = [...document.querySelectorAll("button")].map((button) => button.textContent);
    expect(screen.getByText("ブランチ main の名前変更")).toBeDefined();
    expect(buttons).toEqual(["キャンセル", "名前の変更"]);
  });

  it("プライマリのラベルは `OK` にしない", () => {
    renderDialog();

    expect(screen.queryByText("OK")).toBeNull();
  });

  it("背景のオーバーレイを押すと閉じる", () => {
    const { onCancel } = renderDialog();
    const overlay = document.querySelector("[role=dialog]")?.parentElement;
    if (overlay === null || overlay === undefined) throw new Error("オーバーレイが無い");

    fireEvent.mouseDown(overlay);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("枠の中を押しても閉じない", () => {
    const { onCancel } = renderDialog();

    fireEvent.mouseDown(screen.getByRole("dialog"));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Esc でキャンセル、Enter で確定", () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.keyDown(screen.getByLabelText("ブランチ名"), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByLabelText("ブランチ名"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("確定できないときは Enter でも実行しない", () => {
    const { onConfirm } = renderDialog({ confirmDisabled: true });

    fireEvent.keyDown(screen.getByLabelText("ブランチ名"), { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** ボタンにフォーカスがある Enter は、そのボタンの click に任せる */
  it("キャンセルボタン上の Enter で確定しない", () => {
    const { onConfirm } = renderDialog();

    fireEvent.keyDown(screen.getByText("キャンセル"), { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
