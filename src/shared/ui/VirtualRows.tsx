import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type ReactNode } from "react";

import styles from "./VirtualRows.module.css";

/*
 * 仮想スクロール。
 *
 * 行数が増えても描画コストを一定に保つ (docs/adr/0004-virtual-scroll.md)。
 * スクロール要素は自前スクロールバーのビューポート
 * (docs/adr/0012-scrollbar-and-virtualization.md)。
 *
 * **JSX の `style` を使うのはこのファイルだけ。**
 * 仮想リストは行の位置を実行時に計算して渡すので、CSS Modules では表現できない。
 * ESLint の禁止をここだけ理由付きで外している (docs/security.md)。
 */

interface VirtualRowsProps<T> {
  readonly items: readonly T[];
  readonly rowHeight: number;
  /** 自前スクロールバーのビューポート。まだ無ければ null */
  readonly scrollElement: HTMLElement | null;
  readonly keyOf: (item: T) => string;
  readonly renderRow: (item: T, index: number) => ReactNode;
  /** 画面外に余分に描く行数 */
  readonly overscan?: number;
  /**
   * 画面に入れておきたい行の鍵。
   *
   * **行の並びが変わったときだけ**追いかける。折りたたみで選択行が画面外へ
   * 出たときに戻すのが目的で、選択しただけではスクロールしない
   * (クリックは選択だけ、という仕様: docs/specs/ui.md の「操作」)。
   */
  readonly revealKey?: string | undefined;
}

export function VirtualRows<T>({
  items,
  rowHeight,
  scrollElement,
  keyOf,
  renderRow,
  overscan = 12,
  revealKey,
}: VirtualRowsProps<T>) {
  // React Compiler は useVirtualizer を含む関数の自動メモ化を諦める。
  // ここは自動メモ化に頼っていないので警告だけ外す
  // eslint-disable-next-line react-hooks/incompatible-library -- 仮想化の実装に必要
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    overscan,
  });

  // 並びが変わったかどうかで判断する。選択の変更では動かさない
  const previousItems = useRef(items);
  useEffect(() => {
    if (previousItems.current === items) return;
    previousItems.current = items;
    if (revealKey === undefined) return;
    const index = items.findIndex((item) => keyOf(item) === revealKey);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [items, revealKey, keyOf, virtualizer]);

  return (
    <div
      className={styles.sizer}
      // eslint-disable-next-line no-restricted-syntax -- 全体の高さは行数から実行時に決まる
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={keyOf(item)}
            className={styles.row}
            // eslint-disable-next-line no-restricted-syntax -- 行の位置は仮想化が計算する
            style={{
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
