import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeBranch, makePushPreview } from "@/test/factories";

import { PushDialog } from "./PushDialog";
import styles from "./Dialog.module.css";

/*
 * docs/specs/ui.md の「プッシュ」。
 *
 * 強制プッシュの sha は**この画面で見せていた** `origin/<名前>` のもの
 * (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)。
 */

const AHEAD = [
  { hash: "9f3c1ab", subject: "feat: 追加" },
  { hash: "2b4d6e8", subject: "fix: 直した" },
];

function renderPush(overrides: Partial<Parameters<typeof PushDialog>[0]> = {}) {
  const props = {
    repoName: "acme-api",
    branch: makeBranch("feature/a", { ahead: 2 }),
    preview: makePushPreview({ ahead: AHEAD }),
    onPush: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<PushDialog {...props} />);
  return props;
}

function primary(): HTMLButtonElement {
  const found = document.querySelector(`.${styles.primary}`);
  if (!(found instanceof HTMLButtonElement)) throw new Error("プライマリボタンが無い");
  return found;
}

function forceCheckbox(): HTMLInputElement {
  const found = screen.getByLabelText("強制プッシュ");
  if (!(found instanceof HTMLInputElement)) throw new Error("チェックボックスが無い");
  return found;
}

describe("プッシュダイアログ", () => {
  it("タイトルと送り先とコミット一覧を出す", () => {
    renderPush();

    expect(screen.getByText("コミットを acme-api にプッシュ")).toBeDefined();
    expect(screen.getByText("2 件のコミットをプッシュします")).toBeDefined();
    expect(screen.getByText("feat: 追加")).toBeDefined();
    expect(screen.getByText("fix: 直した")).toBeDefined();
  });

  it("強制プッシュをオンにするとボタンが `強制プッシュ` になり赤くなる", () => {
    renderPush();
    expect(primary().textContent).toBe("プッシュ");
    expect(primary().className).not.toContain(styles.danger);

    fireEvent.click(forceCheckbox());

    expect(primary().textContent).toBe("強制プッシュ");
    expect(primary().className).toContain(styles.danger);
  });

  /** behind だけのブランチに撃つとリモートを巻き戻す (docs/pitfalls.md) */
  it("ahead が 0 のときは強制プッシュのチェックボックス自体を無効にする", () => {
    renderPush({
      branch: makeBranch("feature/a", { ahead: 0, behind: 3 }),
      preview: makePushPreview({ ahead: [] }),
    });

    expect(forceCheckbox().disabled).toBe(true);
    expect(screen.getByText("プッシュするコミットはありません")).toBeDefined();
  });

  /**
   * スナップショットの `ahead` とプレビューは別のタイミングで読む。
   * 混ぜると「3 件をプッシュします」の下に 5 件並ぶ
   */
  it("件数はコミット一覧と同じ情報源から取る", () => {
    renderPush({
      branch: makeBranch("feature/a", { ahead: 5 }),
      preview: makePushPreview({ ahead: AHEAD }),
    });

    expect(screen.getByText("2 件のコミットをプッシュします")).toBeDefined();
    expect(screen.queryByText("5 件のコミットをプッシュします")).toBeNull();
  });

  it("リモート側の名前は Rust が持っている値を使う", () => {
    renderPush({
      branch: makeBranch("local-name", { ahead: 1 }),
      preview: makePushPreview({
        remote: "upstream",
        remote_branch: "remote-name",
        upstream: "upstream/remote-name",
        ahead: AHEAD,
      }),
    });

    expect(screen.getByText("upstream")).toBeDefined();
    expect(screen.getByText("remote-name")).toBeDefined();
  });

  it("ahead も behind もあるときは、失われるコミットを見せる", () => {
    renderPush({
      branch: makeBranch("feature/a", { ahead: 1, behind: 2 }),
      preview: makePushPreview({
        ahead: [AHEAD[0] ?? { hash: "x", subject: "x" }],
        behind: [
          { hash: "aaa1111", subject: "他人のコミット 1" },
          { hash: "bbb2222", subject: "他人のコミット 2" },
        ],
      }),
    });

    fireEvent.click(forceCheckbox());

    expect(screen.getByText("この 2 件のコミットがリモートから失われます")).toBeDefined();
    expect(screen.getByText("他人のコミット 1")).toBeDefined();
  });

  it("強制プッシュのときだけ sha を渡す", () => {
    const { onPush } = renderPush({
      preview: makePushPreview({ ahead: AHEAD, remote_sha: "abc1234" }),
    });

    fireEvent.click(primary());
    expect(onPush).toHaveBeenLastCalledWith(null);

    fireEvent.click(forceCheckbox());
    fireEvent.click(primary());
    expect(onPush).toHaveBeenLastCalledWith("abc1234");
  });

  it("追跡ブランチが無ければ新規に作ると伝える", () => {
    renderPush({
      branch: makeBranch("fresh", { ahead: 0, upstream: null }),
      preview: makePushPreview({ upstream: null, remote_sha: null, ahead: [] }),
    });

    expect(screen.getByText("追跡ブランチが無いので新規に作成します")).toBeDefined();
  });

  it("読み込み中はコミット一覧を出さない", () => {
    renderPush({ preview: null });

    expect(screen.getByText("読み込み中")).toBeDefined();
    expect(screen.queryByText("feat: 追加")).toBeNull();
  });

  /**
   * sha が無いまま強制プッシュを押すと、ボタンが「強制プッシュ」を出しながら
   * 通常プッシュが走る
   */
  it("読み込み中は確定できず、強制プッシュも選べない", () => {
    renderPush({ preview: null });

    expect(primary().disabled).toBe(true);
    expect(forceCheckbox().disabled).toBe(true);
  });

  /** `gone` はプルが無効なので、プッシュが唯一の復旧手段 */
  it("追跡先が消えていても開けて、新規に作ると伝える", () => {
    renderPush({
      branch: makeBranch("topic", { ahead: 0, upstream_gone: true }),
      preview: makePushPreview({
        upstream: "origin/topic",
        remote_sha: null,
        ahead: [],
        behind: [],
      }),
    });

    expect(screen.getByText("追跡ブランチが無いので新規に作成します")).toBeDefined();
    expect(primary().disabled).toBe(false);
    // 比べる相手がいないので強制プッシュは選べない
    expect(forceCheckbox().disabled).toBe(true);
  });

  /** sha が無いまま押すと、ボタンの文言と実際のコマンドがずれる */
  it("リースの sha が無ければ強制プッシュを選べない", () => {
    renderPush({
      branch: makeBranch("feature/a", { ahead: 2 }),
      preview: makePushPreview({ remote_sha: null, ahead: AHEAD }),
    });

    expect(forceCheckbox().disabled).toBe(true);
    expect(primary().textContent).toBe("プッシュ");
  });
});
