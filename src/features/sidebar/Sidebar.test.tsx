import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";

/*
 * ボタンの並びと有効条件 (docs/specs/ui.md の「サイドバー」)。
 * ツリー表示のトグルとコンソールはフェーズ 3。
 */

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    selectedKind: null,
    pullEnabled: false,
    fetchEnabled: true,
    groupDirectories: true,
    localOnly: false,
    consoleOpen: false,
    onFetch: vi.fn(),
    onPull: vi.fn(),
    onExpandLocal: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onAddRepo: vi.fn(),
    onRemoveRepo: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

function button(label: string): HTMLButtonElement {
  const found = screen.getByTitle(label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} がボタンではない`);
  return found;
}

describe("サイドバー", () => {
  it("v2 のボタンは常に無効で、ツールチップに (v2) が付く", () => {
    renderSidebar();

    expect(button("新規ブランチ (v2)").disabled).toBe(true);
    expect(button("ブランチの削除 (v2)").disabled).toBe(true);
  });

  it("選択で無効になるだけのボタンには (v2) を付けない", () => {
    renderSidebar();

    expect(button("選択対象をプル").disabled).toBe(true);
    expect(button("リポジトリをリストから削除").disabled).toBe(true);
  });

  it("プルの有効条件は呼び出し側が決める", () => {
    renderSidebar({ pullEnabled: true });

    expect(button("選択対象をプル").disabled).toBe(false);
  });

  it("リストから削除はリポジトリ行を選んでいるときだけ有効", () => {
    renderSidebar({ selectedKind: "branch" });

    expect(button("リポジトリをリストから削除").disabled).toBe(true);
  });

  it("リポジトリ行を選んでいれば削除できる", () => {
    const props = renderSidebar({ selectedKind: "repo" });

    button("リポジトリをリストから削除").click();

    expect(props.onRemoveRepo).toHaveBeenCalled();
  });

  it("展開・折りたたみとリポジトリの追加は常に押せる", () => {
    const props = renderSidebar();

    button("すべて展開").click();
    button("すべて展開 (ローカルのみ)").click();
    button("すべて折りたたむ").click();
    button("リポジトリを追加").click();

    expect(props.onExpandAll).toHaveBeenCalled();
    expect(props.onExpandLocal).toHaveBeenCalled();
    expect(props.onCollapseAll).toHaveBeenCalled();
    expect(props.onAddRepo).toHaveBeenCalled();
  });

  it("トグルは状態を見た目に出す", () => {
    renderSidebar({ groupDirectories: true, localOnly: false, consoleOpen: false });

    // 押している状態のトグルだけ class が付く
    expect(button("グループ化 ディレクトリ").className).not.toBe(
      button("ローカルのみ表示").className,
    );
  });
});
