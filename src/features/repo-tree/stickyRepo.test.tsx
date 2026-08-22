import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { ROW_HEIGHT } from "@/shared/styles/rowHeight";
import { makeBranch, makeRepo } from "@/test/factories";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import { RepoTree } from "./RepoTree";

/*
 * スクロールで隠れたリポジトリ見出しを、ツリーの上端に固定して残す。
 *
 * **仮想化した行に position: sticky は効かない** ので、固定する見出しは
 * 行とは別に描いている (docs/adr/0004-virtual-scroll.md)。
 * 位置の計算そのものは shared/lib/stickyHeader.test.ts にある。
 *
 * jsdom にはレイアウトが無いので、スクロール量は `scrollTop` に直接書いて
 * `scroll` を投げる。行が描かれる足場は src/test/setup-dom.ts にある。
 */

/** r1 と r2 を開いた行。開いたリポジトリは見出し + 括り + ブランチ 2 = 4 行 */
function rows(): RowNode[] {
  const repos = [
    makeRepo("r1", { local: [makeBranch("main"), makeBranch("topic")] }),
    makeRepo("r2", { name: "acme-web", local: [makeBranch("main"), makeBranch("topic")] }),
    makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
  ];
  return flatten(repos, {
    expanded: new Set(allKeysOf(repos.slice(0, 2), ["local"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function renderTree(nodes: readonly RowNode[]) {
  return render(<RepoTree rows={nodes} onActivate={vi.fn()} onContextMenu={vi.fn()} />);
}

/** ビューポートを動かす。jsdom はスクロールしないので値を書いて知らせる */
function scrollTo(container: HTMLElement, top: number) {
  const viewport = container.querySelector("[data-overlayscrollbars-viewport]");
  if (!(viewport instanceof HTMLElement)) throw new Error("ビューポートが無い");
  viewport.scrollTop = top;
  fireEvent.scroll(viewport);
}

/** 固定して出している見出し。出していなければ null */
function sticky(container: HTMLElement): HTMLElement | null {
  const element = container.querySelector("[class*='sticky']");
  return element instanceof HTMLElement ? element : null;
}

/** 固定した見出しの中の行。無ければ落とす */
function stickyRow(container: HTMLElement): HTMLElement {
  const row = sticky(container)?.querySelector("[data-kind]");
  if (!(row instanceof HTMLElement)) throw new Error("固定した見出しが出ていない");
  return row;
}

beforeEach(() => {
  useUiStore.setState({ selectedKey: null, expanded: new Set<string>() });
  useRepoStore.getState().registerAll([
    { id: "r1", name: "acme-api", path: "/repos/acme-api" },
    { id: "r2", name: "acme-web", path: "/repos/acme-web" },
    { id: "r3", name: "acme-ops", path: "/repos/acme-ops" },
  ]);
});

describe("リポジトリ見出しの固定表示", () => {
  it("先頭を普通に見ているあいだは出さない。行そのものが見えている", () => {
    const { container } = renderTree(rows());

    expect(sticky(container)).toBeNull();
  });

  it("見出しが上端より上に隠れたら、そのリポジトリ名を上端に出す", () => {
    const { container } = renderTree(rows());

    scrollTo(container, 2 * ROW_HEIGHT);

    expect(stickyRow(container).textContent).toContain("acme-api");
  });

  it("次のリポジトリまで進んだら、その見出しに入れ替わる", () => {
    const { container } = renderTree(rows());

    scrollTo(container, 4 * ROW_HEIGHT + 1);

    expect(stickyRow(container).textContent).toContain("acme-web");
  });

  it("次の見出しに押されるぶんだけ上へずらす", () => {
    const { container } = renderTree(rows());

    // r2 の見出しは 84px。84 - 70 - 21 = -7
    scrollTo(container, 70);

    expect(sticky(container)?.style.getPropertyValue("--sticky-y")).toBe("-7px");
  });

  it("次の見出しが遠いあいだはずらさない", () => {
    const { container } = renderTree(rows());

    scrollTo(container, 2 * ROW_HEIGHT);

    expect(sticky(container)?.style.getPropertyValue("--sticky-y")).toBe("0px");
  });

  it("通常の行と同じ見た目で出す (リポジトリ見出しの装飾が付く)", () => {
    const { container } = renderTree(rows());

    scrollTo(container, 2 * ROW_HEIGHT);

    const row = stickyRow(container);
    expect(row.dataset.kind).toBe("repo");
    expect(row.className).toContain("heading");
  });

  it("選択中のリポジトリは、固定した見出しも選択の色になる", () => {
    const nodes = rows();
    useUiStore.setState({ selectedKey: nodes[0]!.key });
    const { container } = renderTree(nodes);

    scrollTo(container, 2 * ROW_HEIGHT);

    expect(stickyRow(container).className).toContain("selected");
  });

  it("固定した見出しをクリックすると選択できる", () => {
    const nodes = rows();
    const { container } = renderTree(nodes);
    scrollTo(container, 2 * ROW_HEIGHT);

    fireEvent.mouseDown(stickyRow(container));

    expect(useUiStore.getState().selectedKey).toBe(nodes[0]!.key);
  });

  it("固定した見出しのシェブロンで開閉できる", () => {
    const nodes = rows();
    const { container } = renderTree(nodes);
    scrollTo(container, 2 * ROW_HEIGHT);
    const chevron = stickyRow(container).querySelector("[class*='chevron']");
    if (chevron === null) throw new Error("シェブロンが無い");

    fireEvent.mouseDown(chevron);

    expect(useUiStore.getState().expanded.has(nodes[0]!.key)).toBe(true);
  });

  it("行が 1 つも無ければ出さない", () => {
    const { container } = renderTree([]);

    expect(sticky(container)).toBeNull();
  });

  it("リポジトリ見出しが無い並びでは出さない", () => {
    // 括り行とブランチ行だけ (検索の絞り込みで見出しが落ちた形)
    const { container } = renderTree(rows().slice(1, 4));

    scrollTo(container, 2 * ROW_HEIGHT);

    expect(sticky(container)).toBeNull();
  });

  /**
   * 固定した見出しからのドラッグ並び替えは対象外。
   *
   * ドラッグの購読は行の器 (`.layer`) に張ってあるので、固定側を器の外に
   * 描くことで自然に外れる (docs/adr/0019-reorder-without-dnd-kit.md)。
   */
  it("固定した見出しからはドラッグ並び替えを始めない", () => {
    const { container } = renderTree(rows());
    scrollTo(container, 2 * ROW_HEIGHT);
    const layer = container.querySelector("[class*='layer']");
    if (!(layer instanceof HTMLElement)) throw new Error("行の器が無い");

    fireEvent.pointerDown(stickyRow(container), { clientY: 5, button: 0 });
    fireEvent.pointerMove(window, { clientY: 8 * ROW_HEIGHT, buttons: 1 });
    fireEvent.pointerUp(window);

    expect(layer.contains(stickyRow(container))).toBe(false);
    expect(useRepoStore.getState().order).toEqual(["r1", "r2", "r3"]);
  });
});
