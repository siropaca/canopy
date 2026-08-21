import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu";
import type { MenuItem } from "./menuItems";

const ITEMS: MenuItem[] = [
  { kind: "action", label: "プル", action: { type: "pull" }, disabled: false },
  { kind: "action", label: "プッシュ", action: { type: "push" }, disabled: true },
  { kind: "separator" },
  { kind: "v2", label: "新規ブランチ" },
  {
    kind: "submenu",
    label: "パス/参照のコピー",
    items: [
      { kind: "title", label: "コピー" },
      {
        kind: "action",
        label: "絶対パス",
        action: { type: "copy", text: "/repos/acme-api" },
        disabled: false,
        value: "/repos/acme-api",
      },
    ],
  },
];

function renderMenu(items: MenuItem[] = ITEMS) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(<ContextMenu items={items} at={{ x: 10, y: 20 }} onAction={onAction} onClose={onClose} />);
  return { onAction, onClose };
}

describe("コンテキストメニュー", () => {
  it("押した項目の操作を渡して閉じる", () => {
    const { onAction, onClose } = renderMenu();

    fireEvent.click(screen.getByText("プル"));

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: "pull" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("無効な項目と v2 の項目は押せない", () => {
    renderMenu();

    for (const label of ["プッシュ", "新規ブランチ"]) {
      const button = screen.getByText(label).closest("button");
      expect(button).toHaveProperty("disabled", true);
    }
  });

  it("メニューの外を押すと閉じる", () => {
    const { onClose } = renderMenu();

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("メニューの中を押しても閉じない", () => {
    const { onClose } = renderMenu();

    fireEvent.mouseDown(screen.getByText("プル"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("サブメニューはホバーで開き、項目の右に値を出す", () => {
    const { onAction } = renderMenu();
    expect(screen.queryByText("絶対パス")).toBeNull();

    fireEvent.mouseEnter(screen.getByText("パス/参照のコピー"));

    expect(screen.getByText("コピー")).toBeDefined();
    expect(screen.getByText("/repos/acme-api")).toBeDefined();
    fireEvent.click(screen.getByText("絶対パス"));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: "copy",
      text: "/repos/acme-api",
    });
  });

  it("他の項目をホバーするとサブメニューが閉じる", () => {
    renderMenu();
    fireEvent.mouseEnter(screen.getByText("パス/参照のコピー"));
    expect(screen.getByText("絶対パス")).toBeDefined();

    fireEvent.mouseEnter(screen.getByText("プル"));

    expect(screen.queryByText("絶対パス")).toBeNull();
  });
});
