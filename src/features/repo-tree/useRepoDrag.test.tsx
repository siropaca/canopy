import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { ROW_HEIGHT } from "@/shared/styles/rowHeight";
import { makeBranch, makeRepo } from "@/test/factories";
import { useRepoStore } from "@/store/useRepoStore";

import { RepoTree } from "./RepoTree";

/*
 * リポジトリ見出しのドラッグ並び替え。
 *
 * **ドロップ位置は行のインデックスから決める** ので、jsdom でも
 * 座標を渡せば判定できる (docs/adr/0019-reorder-without-dnd-kit.md)。
 * 位置の計算そのものは shared/lib/reorder.test.ts にある。
 */

function rows(): RowNode[] {
  const repos = [
    makeRepo("r1", { local: [makeBranch("main")] }),
    makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
    makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
  ];
  return flatten(repos, {
    expanded: new Set<string>(),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function order(): readonly string[] {
  return useRepoStore.getState().order;
}

/** 行の真ん中あたりの座標 */
function middleOf(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function renderTree() {
  return render(<RepoTree rows={rows()} onActivate={vi.fn()} onContextMenu={vi.fn()} />);
}

/**
 * ドラッグを始める。
 *
 * 掴む行は DOM から取る (ポインタの下にあるので必ず描かれている)。
 * 落とす位置だけを座標から決める (docs/adr/0019-reorder-without-dnd-kit.md)。
 */
function grab(container: HTMLElement, index: number, button = 0) {
  const row = container.querySelector(`[data-index="${index}"]`);
  if (row === null) throw new Error(`${index} 行目が描かれていない`);
  fireEvent.pointerDown(row, { clientY: middleOf(index), button });
}

/** 動かす。実際のドラッグはボタンを押したまま動く */
function move(clientY: number) {
  fireEvent.pointerMove(window, { clientY, buttons: 1 });
}

beforeEach(() => {
  useRepoStore.getState().registerAll([
    { id: "r1", name: "acme-api", path: "/repos/acme-api" },
    { id: "r2", name: "acme-web", path: "/repos/acme-web" },
    { id: "r3", name: "acme-ops", path: "/repos/acme-ops" },
  ]);
});

describe("リポジトリのドラッグ並び替え", () => {
  it("下へ落とすとその位置に入る", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(2));
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r2", "r3", "r1"]);
  });

  it("上へ落とすとその位置に入る", () => {
    const { container } = renderTree();

    grab(container, 2);
    move(1);
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r3", "r1", "r2"]);
  });

  it("しきい値を超えなければドラッグを始めない (ただのクリック)", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(0) + 2);

    // 少し動かしただけで線が出ると、クリックのたびに画面がちらつく
    expect(container.querySelector("[class*='dropLine']")).toBeNull();
    expect(container.querySelector("[class*='dragging']")).toBeNull();

    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  it("ブランチの行はドラッグできない", () => {
    const expanded = new Set(["r1|repo|", "r1|local|"]);
    const repos = [
      makeRepo("r1", { local: [makeBranch("main")] }),
      makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
      makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
    ];
    const opened = flatten(repos, {
      expanded,
      query: "",
      groupDirectories: true,
      localOnly: false,
    });
    const { container } = render(
      <RepoTree rows={opened} onActivate={vi.fn()} onContextMenu={vi.fn()} />,
    );

    // 2 行目は「ローカル」の括り行
    grab(container, 1);
    move(middleOf(3));
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  it("右クリックでは始めない", () => {
    const { container } = renderTree();

    grab(container, 0, 2);
    move(middleOf(2));
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  it("Esc で取り消す", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(2));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  /** 端に入っているあいだはスクロールする。掴んだまま画面外へ落とせないと困る */
  it("下端に入るとスクロールする", () => {
    const { container } = renderTree();
    const viewport = container.querySelector("[data-overlayscrollbars-viewport]");
    if (!(viewport instanceof HTMLElement)) throw new Error("ビューポートが無い");
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200 }),
      configurable: true,
    });
    viewport.scrollTop = 0;

    grab(container, 0);
    move(195);

    expect(viewport.scrollTop).toBeGreaterThan(0);
  });

  it("端から離れればスクロールを止める", () => {
    const { container } = renderTree();
    const viewport = container.querySelector("[data-overlayscrollbars-viewport]");
    if (!(viewport instanceof HTMLElement)) throw new Error("ビューポートが無い");
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200 }),
      configurable: true,
    });

    grab(container, 0);
    move(195);
    const scrolled = viewport.scrollTop;
    move(100);

    expect(viewport.scrollTop).toBe(scrolled);
  });

  it("ポインタが取り消されたら畳む", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(2));
    fireEvent.pointerCancel(window);

    expect(container.querySelector("[class*='dropLine']")).toBeNull();
    fireEvent.pointerUp(window);
    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  /** 取りこぼした pointerup が残っていると、触っていないのに並びが変わる */
  it("取りこぼした掴みかけを次の押し下げで捨てる", () => {
    const expanded = new Set(["r1|repo|", "r1|local|"]);
    const repos = [
      makeRepo("r1", { local: [makeBranch("main")] }),
      makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
      makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
    ];
    const { container } = render(
      <RepoTree
        rows={flatten(repos, { expanded, query: "", groupDirectories: true, localOnly: false })}
        onActivate={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );

    // r1 の見出しを掴んだまま pointerup を取りこぼす
    grab(container, 0);
    // 次に括り行 (ドラッグできない行) を押す
    grab(container, 1);
    move(middleOf(4));
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  it("ボタンを離した瞬間を取りこぼしても、次に動かした時点で畳む", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(2));
    // pointerup を取りこぼした状態でマウスだけ動く
    fireEvent.pointerMove(window, { clientY: middleOf(1), buttons: 0 });

    expect(container.querySelector("[class*='dropLine']")).toBeNull();
    fireEvent.pointerUp(window);
    expect(order()).toEqual(["r1", "r2", "r3"]);
  });

  /** 掴んでいる最中にスナップショットが届くと、ブロックの高さが変わる */
  it("ドラッグ中に行が入れ替わったら、新しい行で落とす位置を決める", () => {
    const { container, rerender } = renderTree();

    grab(container, 0);

    // r1 を開いて 4 行に増やす (見出し + 括り + ブランチ 2)
    const opened = [
      makeRepo("r1", { local: [makeBranch("main"), makeBranch("topic")] }),
      makeRepo("r2", { name: "acme-web", local: [makeBranch("main")] }),
      makeRepo("r3", { name: "acme-ops", local: [makeBranch("main")] }),
    ];
    rerender(
      <RepoTree
        rows={flatten(opened, {
          expanded: new Set(allKeysOf([opened[0]!], ["local"])),
          query: "",
          groupDirectories: true,
          localOnly: false,
        })}
        onActivate={vi.fn()}
        onContextMenu={vi.fn()}
      />,
    );
    // 5 行目 = r2 のブロック (r1 が 4 行に増えた後の並び)
    move(middleOf(4) + 6);
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r2", "r1", "r3"]);
  });

  /**
   * 器の上に余白が入っても、掴む行と落ちる位置がずれない。
   *
   * スクロール要素を原点にすると、余白のぶんだけ下の行を指す
   * (フェーズ 4 で余白を 1 つ足しただけで壊れる)
   */
  it("行の器がずれていても、その原点から位置を決める", () => {
    const { container } = renderTree();
    const layer = container.querySelector("[class*='layer']");
    if (!(layer instanceof HTMLElement)) throw new Error("器が無い");
    Object.defineProperty(layer, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 300, left: 0, right: 300, width: 300, height: 200 }),
      configurable: true,
    });

    // 末尾のリポジトリを掴んで、器の先頭 (画面では 100px の位置) へ落とす
    grab(container, 2);
    move(100 + 5);
    fireEvent.pointerUp(window);

    expect(order()).toEqual(["r3", "r1", "r2"]);
  });

  it("ドラッグ中は挿入線を出す", () => {
    const { container } = renderTree();

    grab(container, 0);
    move(middleOf(2));

    const line = container.querySelector("[class*='dropLine']");
    expect(line).not.toBeNull();
    expect((line as HTMLElement).style.getPropertyValue("--drop-y")).toBe(`${ROW_HEIGHT * 3}px`);
  });
});
