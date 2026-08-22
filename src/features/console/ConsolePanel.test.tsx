import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsoleBlock } from "@/shared/lib/consoleLog";
import { useConsoleStore } from "@/store/useConsoleStore";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import { ConsolePanel } from "./ConsolePanel";

/*
 * コンソールパネル。見え方は docs/specs/ui.md の「コンソール」。
 */

function block(cwd: string, command: string, output: readonly string[] = []): ConsoleBlock {
  return {
    lines: [
      { kind: "command", text: `02:04:17.543: [${cwd}] ${command}` },
      ...output.map((text) => ({ kind: "error" as const, text })),
    ],
  };
}

/** コマンド行 + 通常の出力 + エラー行の 3 種類がそろったブロック */
function threeKinds(): ConsoleBlock {
  return {
    lines: [
      { kind: "command", text: "02:04:17.543: [/repos/acme-api] git pull --rebase" },
      { kind: "output", text: "From github.com:acme/acme-api" },
      { kind: "error", text: "error: cannot pull with rebase" },
    ],
  };
}

function append(repoId: string, blocks: ConsoleBlock[], failed = false) {
  useConsoleStore.getState().append(repoId, blocks, { failed });
}

beforeEach(() => {
  useRepoStore.getState().registerAll([
    { id: "r1", name: "acme-api", path: "/repos/acme-api" },
    { id: "r2", name: "acme-web", path: "/repos/acme-web" },
  ]);
  useConsoleStore.setState({
    blocks: new Map(),
    activeTab: null,
    failed: new Set(),
    nextBlockId: 1,
  });
  useUiStore.setState({ consoleOpen: true });
});

describe("コンソールパネル", () => {
  it("閉じているときは何も描かない", () => {
    useUiStore.setState({ consoleOpen: false });
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);

    const { container } = render(<ConsolePanel />);

    expect(container.textContent).toBe("");
  });

  it("タブが無いときは見出しと空の断りを出す", () => {
    render(<ConsolePanel />);

    expect(screen.getByText("コンソール")).toBeDefined();
    expect(screen.getByText("出力はまだありません")).toBeDefined();
  });

  it("読み取り専用であることを出す", () => {
    render(<ConsolePanel />);

    expect(screen.getByText("読み取り専用")).toBeDefined();
    expect(screen.getByTitle("このビューは読み取り専用です")).toBeDefined();
  });

  it("出力があったリポジトリの名前がタブに出る", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);
    append("r2", [block("/repos/acme-web", "git pull --rebase")]);

    render(<ConsolePanel />);

    expect(screen.getByRole("button", { name: "acme-api" })).toBeDefined();
    expect(screen.getByRole("button", { name: "acme-web" })).toBeDefined();
  });

  it("開いているタブの出力を出す", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);

    render(<ConsolePanel />);

    expect(screen.getByText("02:04:17.543: [/repos/acme-api] git fetch --prune")).toBeDefined();
  });

  it("タブを押すと中身が入れ替わる", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);
    append("r2", [block("/repos/acme-web", "git pull --rebase")]);

    render(<ConsolePanel />);
    fireEvent.click(screen.getByRole("button", { name: "acme-web" }));

    expect(screen.getByText("02:04:17.543: [/repos/acme-web] git pull --rebase")).toBeDefined();
    expect(screen.queryByText("02:04:17.543: [/repos/acme-api] git fetch --prune")).toBeNull();
  });

  it("失敗したタブのドットは、そのタブを開くと消える", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);
    append("r2", [block("/repos/acme-web", "git pull --rebase", ["error: cannot pull"])], true);

    render(<ConsolePanel />);
    expect(screen.getByTitle("失敗した出力があります")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "acme-web" }));

    expect(screen.queryByTitle("失敗した出力があります")).toBeNull();
  });

  it("タブは個別に閉じられる。閉じてもパネルは開いたまま", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);

    render(<ConsolePanel />);
    fireEvent.click(screen.getByTitle("acme-api のタブを閉じる"));

    expect(screen.queryByRole("button", { name: "acme-api" })).toBeNull();
    expect(screen.getByText("出力はまだありません")).toBeDefined();
    expect(useUiStore.getState().consoleOpen).toBe(true);
  });

  it("パネルの ✕ でコンソールを閉じる", () => {
    render(<ConsolePanel />);
    fireEvent.click(screen.getByTitle("コンソールを閉じる"));

    expect(useUiStore.getState().consoleOpen).toBe(false);
  });

  /** 出力は折り返すので、行の高さは実測する (docs/specs/ui.md の「コンソール」) */
  it("行の高さを固定しない", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);

    const { container } = render(<ConsolePanel />);

    const line = container.querySelector("[data-index]");
    expect(line).not.toBeNull();
    expect((line as HTMLElement).style.height).toBe("");
  });

  /** ui.md は「コマンド行は明るいグレー、エラー行は赤、通常の出力は落としたグレー」 */
  it("コマンド行・通常の出力・エラー行を 3 色で出し分ける", () => {
    append("r1", [threeKinds()], true);

    render(<ConsolePanel />);

    const command = screen.getByText("02:04:17.543: [/repos/acme-api] git pull --rebase");
    const output = screen.getByText("From github.com:acme/acme-api");
    const error = screen.getByText("error: cannot pull with rebase");

    expect(new Set([command.className, output.className, error.className]).size).toBe(3);
    // 取り違えを弾く。CSS Modules はハッシュを付けるので部分一致で見る
    expect(command.className).toMatch(/command/);
    expect(output.className).toMatch(/plain/);
    expect(error.className).toMatch(/error/);
  });

  /** 新しい出力が届いたら末尾を見せる。手でスクロールし直さない */
  it("新しい出力が届いたら末尾に追いつく", () => {
    append("r1", [block("/repos/acme-api", "git fetch --prune")]);
    const { container } = render(<ConsolePanel />);
    const viewport = container.querySelector("[data-overlayscrollbars-viewport]");
    if (!(viewport instanceof HTMLElement)) throw new Error("ビューポートが無い");
    const scrollTo = vi.fn();
    Object.defineProperty(viewport, "scrollTo", { value: scrollTo, configurable: true });

    act(() => {
      append("r1", [block("/repos/acme-api", "git pull --rebase")]);
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  /** 出力は増え続けるので全行を DOM に置かない (docs/adr/0012-scrollbar-and-virtualization.md) */
  it("画面に入る分だけ描く (仮想スクロール)", () => {
    const many: ConsoleBlock[] = Array.from({ length: 400 }, (_, index) => ({
      lines: [{ kind: "command", text: `line ${index}` }],
    }));
    append("r1", many);

    const { container } = render(<ConsolePanel />);

    const drawn = container.querySelectorAll("[data-index]").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(many.length);
  });
});
