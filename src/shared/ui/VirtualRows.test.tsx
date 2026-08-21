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

/** スクロール要素の代わり。scrollTo の呼び出しを数える */
function makeScrollElement() {
  const element = document.createElement("div");
  const scrollTo = vi.fn();
  Object.defineProperty(element, "scrollTo", { value: scrollTo, writable: true });
  Object.defineProperty(element, "clientHeight", { value: 200, configurable: true });
  document.body.append(element);
  return { element, scrollTo };
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
