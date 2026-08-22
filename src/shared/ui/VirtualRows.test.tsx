import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VirtualRows } from "./VirtualRows";

/*
 * 「選択行までスクロール」がいつ動くかを縛る。
 *
 * jsdom にはレイアウトが無いので、行の位置までは確かめられない。
 * ここで見るのは**スクロールを要求したかどうか**だけ。
 * 選択しただけで先端まで飛ぶ不具合を出したので、その再発を止める。
 */

interface Row {
  readonly key: string;
}

/**
 * スクロール要素の代わり。scrollTo の呼び出しを数える。
 *
 * jsdom はレイアウトを持たないので寸法が全部 0 になる。仮想化は
 * ビューポートの高さから描く範囲を決めるため、**寸法を与えないと 1 行も描かれない**。
 */
function makeScrollElement() {
  const element = document.createElement("div");
  const scrollTo = vi.fn();
  Object.defineProperty(element, "scrollTo", { value: scrollTo, writable: true });
  Object.defineProperty(element, "clientHeight", { value: 200, configurable: true });
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({ width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }),
    configurable: true,
  });
  document.body.append(element);
  return { element, scrollTo };
}

/** 器の高さ (仮想化が全行から計算した値) */
function sizerHeight(container: HTMLElement): number {
  const sizer = container.firstElementChild;
  if (!(sizer instanceof HTMLElement)) throw new Error("器が無い");
  return Number.parseInt(sizer.style.height, 10);
}

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ key: `k${index}` }));
}

function renderRows(items: Row[], revealKey: string | undefined, element: HTMLElement) {
  return render(
    <VirtualRows
      items={items}
      rowHeight={21}
      scrollElement={element}
      keyOf={(row: Row) => row.key}
      renderRow={(row: Row) => <span>{row.key}</span>}
      revealKey={revealKey}
    />,
  );
}

describe("仮想リストの追いかけ", () => {
  it("選択が変わっただけではスクロールしない", () => {
    const { element, scrollTo } = makeScrollElement();
    const items = rows(50);
    const { rerender } = renderRows(items, "k0", element);
    scrollTo.mockClear();

    // 同じ配列のまま、選択だけを動かす
    rerender(
      <VirtualRows
        items={items}
        rowHeight={21}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        revealKey="k40"
      />,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("行の並びが変わったら選択行を画面に入れる", () => {
    const { element, scrollTo } = makeScrollElement();
    const { rerender } = renderRows(rows(50), "k40", element);
    scrollTo.mockClear();

    // 折りたたみで行が減った
    rerender(
      <VirtualRows
        items={rows(20)}
        rowHeight={21}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        revealKey="k15"
      />,
    );

    expect(scrollTo).toHaveBeenCalled();
  });

  /**
   * スナップショットが届くたびに `flatten` が新しい配列を返す。
   * 中身の並びが同じなら追いかけない (一括フェッチで 11 回引き戻される)
   */
  it("並びが同じなら、配列が作り直されてもスクロールしない", () => {
    const { element, scrollTo } = makeScrollElement();
    const { rerender } = renderRows(rows(50), "k40", element);
    scrollTo.mockClear();

    // 同じ鍵・同じ並びの新しい配列 (スナップショットが 1 件届いた状態)
    rerender(
      <VirtualRows
        items={rows(50)}
        rowHeight={21}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        revealKey="k40"
      />,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("選択が無ければ並びが変わってもスクロールしない", () => {
    const { element, scrollTo } = makeScrollElement();
    const { rerender } = renderRows(rows(50), undefined, element);
    scrollTo.mockClear();

    rerender(
      <VirtualRows
        items={rows(20)}
        rowHeight={21}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        revealKey={undefined}
      />,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("消えた行を選んでいてもスクロールしない", () => {
    const { element, scrollTo } = makeScrollElement();
    const { rerender } = renderRows(rows(50), "k40", element);
    scrollTo.mockClear();

    // k40 が無くなった並びに差し替える
    rerender(
      <VirtualRows
        items={rows(10)}
        rowHeight={21}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        revealKey="k40"
      />,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

/*
 * 高さを実測するモード。
 *
 * コンソールの出力は折り返すので行の高さが一定にならない
 * (docs/specs/ui.md の「コンソール」)。固定高で描くと、折り返した分だけ
 * 行が重なる。実測は仮想化に任せるので、DOM 側の約束
 * (`data-index` があること、高さを固定しないこと) だけを見る。
 */
describe("高さを実測するモード", () => {
  it("行の高さを固定しない", () => {
    const { element } = makeScrollElement();

    const { container } = render(
      <VirtualRows
        items={rows(3)}
        rowHeight={19}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        measure
      />,
    );

    const row = container.querySelector("[data-index]");
    expect(row).not.toBeNull();
    expect((row as HTMLElement).style.height).toBe("");
  });

  /**
   * 実測が効いているかは器の高さで見える。
   * 実測をやめると `rowHeight` の見積もりのままになる
   */
  it("実測した高さが器の高さに反映される", () => {
    const { element } = makeScrollElement();

    const measured = render(
      <VirtualRows
        items={rows(3)}
        rowHeight={19}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
        measure
      />,
    );
    const measuredHeight = sizerHeight(measured.container);
    measured.unmount();

    const estimated = render(
      <VirtualRows
        items={rows(3)}
        rowHeight={19}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
      />,
    );

    expect(sizerHeight(estimated.container)).toBe(19 * 3);
    expect(measuredHeight).not.toBe(19 * 3);
  });

  it("実測しないときは行の高さを渡す", () => {
    const { element } = makeScrollElement();

    const { container } = render(
      <VirtualRows
        items={rows(3)}
        rowHeight={19}
        scrollElement={element}
        keyOf={(row: Row) => row.key}
        renderRow={(row: Row) => <span>{row.key}</span>}
      />,
    );

    const row = container.querySelector("[data-index]");
    expect(row).not.toBeNull();
    expect((row as HTMLElement).style.height).toBe("19px");
  });
});
