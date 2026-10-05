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

const COLOR_ITEMS: MenuItem[] = [
  {
    kind: "action",
    label: "なし",
    action: { type: "setColor", color: null },
    disabled: false,
    swatch: "none",
  },
  {
    kind: "action",
    label: "紫",
    action: { type: "setColor", color: "purple" },
    disabled: false,
    swatch: "purple",
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

  /** 見本は見出しに塗る色そのもの (docs/adr/0024-repo-heading-color.md) */
  it("色見本を項目名の左に出す", () => {
    renderMenu(COLOR_ITEMS);

    const swatchOf = (label: string) =>
      screen.getByText(label).closest("button")?.firstElementChild?.getAttribute("data-swatch");

    expect(swatchOf("なし")).toBe("none");
    expect(swatchOf("紫")).toBe("purple");
  });

  it("色見本の無い項目には出さない", () => {
    renderMenu();

    expect(document.querySelector("[data-swatch]")).toBeNull();
  });

  it("色の項目を押すとその色を付ける操作を渡す", () => {
    const { onAction } = renderMenu(COLOR_ITEMS);

    fireEvent.click(screen.getByText("紫"));

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: "setColor", color: "purple" });
  });

  it("他の項目をホバーするとサブメニューが閉じる", () => {
    renderMenu();
    fireEvent.mouseEnter(screen.getByText("パス/参照のコピー"));
    expect(screen.getByText("絶対パス")).toBeDefined();

    fireEvent.mouseEnter(screen.getByText("プル"));

    expect(screen.queryByText("絶対パス")).toBeNull();
  });
});
