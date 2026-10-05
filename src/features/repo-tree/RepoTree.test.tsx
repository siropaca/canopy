import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { makeBranch, makeRepo } from "@/test/factories";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import { RepoTree, TreePane } from "./RepoTree";
import styles from "./RepoTree.module.css";

/*
 * ツリー領域の 3 状態 (docs/specs/ui.md の「読み込み中とエラー」)。
 * 行そのものの描画は TreeRow.test.tsx で見ている。
 */

function rowsOfOneRepo(): RowNode[] {
  const repo = makeRepo("r1");
  return flatten([repo], {
    expanded: new Set<string>(),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

describe("ツリー領域", () => {
  beforeEach(() => {
    useRepoStore.setState({ byId: new Map(), order: [], loaded: false, loadError: null });
  });

  it("読み終える前は何も出さない。「登録されていません」を一瞬出さない", () => {
    const { container } = render(
      <RepoTree rows={[]} onActivate={vi.fn()} onContextMenu={vi.fn()} />,
    );

    expect(container.textContent).toBe("");
  });

  it("登録が 0 件なら、その旨を出す", () => {
    useRepoStore.setState({ byId: new Map(), order: [], loaded: true, loadError: null });

    render(<RepoTree rows={[]} onActivate={vi.fn()} onContextMenu={vi.fn()} />);

    expect(screen.getByText("リポジトリが登録されていません")).toBeDefined();
  });

  it("設定が読めなかったら理由を出す。握りつぶさない", () => {
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: true,
      loadError: "設定の中身が壊れています (canopy.json)",
    });

    render(<RepoTree rows={rowsOfOneRepo()} onActivate={vi.fn()} onContextMenu={vi.fn()} />);

    expect(screen.getByText("設定の中身が壊れています (canopy.json)")).toBeDefined();
  });
});

/** 2 リポジトリを開いた行 */
function openRows(): RowNode[] {
  const repos = [
    makeRepo("r1", { local: [makeBranch("main")] }),
    makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
  ];
  return flatten(repos, {
    expanded: new Set(["r1|repo|", "r1|local|", "r2|repo|", "r2|local|"]),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function renderOpenTree() {
  useRepoStore.setState({ byId: new Map(), order: [], loaded: true, loadError: null });
  const rows = openRows();
  const rendered = render(<RepoTree rows={rows} onActivate={vi.fn()} onContextMenu={vi.fn()} />);
  return { ...rendered, rows };
}

/** スクロールするビューポート。最後の行より下の空いた所はここに当たる */
function viewportOf(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector("[data-overlayscrollbars-viewport]");
  if (!(viewport instanceof HTMLElement)) throw new Error("ビューポートが無い");
  return viewport;
}

function headingRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-kind='repo']")];
}

describe("見出しの色 (docs/adr/0024-repo-heading-color.md)", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedKey: null, repoColors: new Map() });
  });

  it("色を付けたリポジトリの見出しだけに色が出る", () => {
    useUiStore.setState({ repoColors: new Map([["r2", "blue"]]) });

    const { container } = renderOpenTree();

    expect(headingRows(container).map((row) => row.dataset.color ?? null)).toEqual([null, "blue"]);
  });

  it("色を変えるとすぐに塗り替わる", () => {
    const { container } = renderOpenTree();

    act(() => {
      useUiStore.getState().setRepoColor("r1", "yellow");
    });

    expect(headingRows(container)[0]?.dataset.color).toBe("yellow");
  });
});

/**
 * 選択を外す手段 (docs/adr/0026-clear-selection-on-empty-area.md)。
 * これが無いと、サイドバーのフェッチで全リポジトリを対象にできない
 */
describe("空いた所のクリック", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedKey: "r1|local|leaf|main", repoColors: new Map() });
  });

  it("行が無い所を押すと選択を外す", () => {
    const { container } = renderOpenTree();

    fireEvent.mouseDown(viewportOf(container), { button: 0 });

    expect(useUiStore.getState().selectedKey).toBeNull();
  });

  it("行を押したときは、その行を選ぶ。外さない", () => {
    const { container } = renderOpenTree();
    const heading = headingRows(container)[1];
    if (heading === undefined) throw new Error("2 つ目の見出しが無い");

    fireEvent.mouseDown(heading, { button: 0 });

    expect(useUiStore.getState().selectedKey).toBe("r2|repo|");
  });

  it("右クリックでは外さない", () => {
    const { container } = renderOpenTree();

    fireEvent.mouseDown(viewportOf(container), { button: 2 });

    expect(useUiStore.getState().selectedKey).toBe("r1|local|leaf|main");
  });

  /** macOS の Ctrl+クリックは右クリックと同じ。左ボタンとして届くが外さない */
  it("Ctrl+クリックでは外さない", () => {
    const { container } = renderOpenTree();

    fireEvent.mouseDown(viewportOf(container), { button: 0, ctrlKey: true });

    expect(useUiStore.getState().selectedKey).toBe("r1|local|leaf|main");
  });

  /**
   * 行を並べる器の下の余白。仮想リストの器は行の高さぴったりなので、これが無いと
   * ツリーが画面より長いときに押せる所が無くなる
   */
  it("最後の行の下の余白を押しても外す", () => {
    const { container } = renderOpenTree();
    const layer = container.querySelector(`.${styles.layer}`);
    if (layer === null) throw new Error("行を並べる器が無い");

    fireEvent.mouseDown(layer, { button: 0 });

    expect(useUiStore.getState().selectedKey).toBeNull();
  });

  /** スクロールバーを掴んだだけで選択が消えると、選んだ行を探しに行けない */
  it("スクロールバーを押しても外さない", () => {
    const { container } = renderOpenTree();
    const scrollbar = container.querySelector(".os-scrollbar-handle");
    if (scrollbar === null) throw new Error("スクロールバーが無い");

    fireEvent.mouseDown(scrollbar, { button: 0 });

    expect(useUiStore.getState().selectedKey).toBe("r1|local|leaf|main");
  });
});

/** 詳細ペインを隠す (docs/adr/0025-hide-detail-pane.md) */
describe("ツリーのペインの幅", () => {
  function paneOf(container: HTMLElement): HTMLElement {
    const pane = container.querySelector("[data-tree-pane]");
    if (!(pane instanceof HTMLElement)) throw new Error("ツリーのペインが無い");
    return pane;
  }

  it("詳細ペインを出しているあいだは保存した幅で固定する", () => {
    useUiStore.setState({ paneWidth: 420 });

    const { container } = render(<TreePane fill={false}>{null}</TreePane>);

    expect(paneOf(container).className).not.toContain(styles.fill);
    expect(paneOf(container).style.getPropertyValue("--pane-width")).toBe("420px");
  });

  /** 隠すかどうかは App が決めて渡す。ペインが自分でストアを読むと判断が 2 箇所になる */
  it("詳細ペインを隠すと残りの幅を全部使う", () => {
    useUiStore.setState({ paneWidth: 420 });

    const { container } = render(<TreePane fill>{null}</TreePane>);

    expect(paneOf(container).className).toContain(styles.fill);
  });
});
