import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeBranch } from "@/test/factories";

import { DeleteBranchDialog } from "./DeleteBranchDialog";
import styles from "./Dialog.module.css";

/*
 * docs/specs/ui.md の「ブランチの削除」。
 *
 * **既定は `git branch -d`。** マージ済みかはここで判定せず、git に拒否させる
 * (docs/adr/0021-delete-local-branch.md)。
 */

function renderDelete(overrides: Partial<Parameters<typeof DeleteBranchDialog>[0]> = {}) {
  const props = {
    repoName: "acme-api",
    branch: makeBranch("feature/a"),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<DeleteBranchDialog {...props} />);
  return props;
}

function primary(): HTMLButtonElement {
  const found = document.querySelector(`.${styles.primary}`);
  if (!(found instanceof HTMLButtonElement)) throw new Error("プライマリボタンが無い");
  return found;
}

function forceCheckbox(): HTMLInputElement {
  const found = screen.getByLabelText("マージされていなくても削除");
  if (!(found instanceof HTMLInputElement)) throw new Error("チェックボックスが無い");
  return found;
}

describe("削除のダイアログ", () => {
  it("タイトルにブランチ名を出す", () => {
    renderDelete();

    expect(screen.getByText("ブランチ feature/a を削除")).toBeDefined();
  });

  /** **既定は強制ではない。** git の安全策をそのまま使う */
  it("既定は強制ではない。押すと force なしで確定する", () => {
    const { onDelete } = renderDelete();

    expect(forceCheckbox().checked).toBe(false);
    expect(primary().textContent).toBe("削除");
    expect(primary().className).not.toContain(styles.danger);

    primary().click();

    expect(onDelete).toHaveBeenCalledWith(false);
  });

  it("強制をオンにするとボタンが `強制削除` になり赤くなる", () => {
    const { onDelete } = renderDelete();

    fireEvent.click(forceCheckbox());

    expect(primary().textContent).toBe("強制削除");
    expect(primary().className).toContain(styles.danger);
    expect(
      screen.getByText("マージしていないコミットも一緒に消えます。元に戻せません"),
    ).toBeDefined();

    primary().click();

    expect(onDelete).toHaveBeenCalledWith(true);
  });

  it("追跡先が消えているブランチは、その旨を出す", () => {
    renderDelete({
      branch: makeBranch("feature/a", { upstream: "origin/feature/a", upstream_gone: true }),
    });

    expect(screen.getByText("acme-api の 追跡先の origin/feature/a は削除済みです")).toBeDefined();
  });

  it("追跡先が無いブランチは、ローカルだけと出す", () => {
    renderDelete({ branch: makeBranch("spike", { upstream: null }) });

    expect(screen.getByText("acme-api の ローカルだけのブランチです")).toBeDefined();
  });

  /** 消えるコミットがあることは、押す前に分かる範囲で出す */
  it("ahead があるブランチは進んでいる件数を出す", () => {
    renderDelete({ branch: makeBranch("feature/a", { ahead: 3 }) });

    expect(
      screen.getByText("acme-api の origin/feature/a より 3 コミット進んでいます"),
    ).toBeDefined();
  });

  it("キャンセルで閉じる", () => {
    const { onCancel } = renderDelete();

    screen.getByText("キャンセル").click();

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
