import { useCallback, useRef, useState } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Splitter.module.css";

/*
 * ペインの境界。ドラッグで幅を変える。
 * 置き場所は shared/ui。コンソールとツリーの両方で使う (docs/architecture.md)。
 */

interface SplitterProps {
  /** ドラッグ開始時の幅 */
  readonly width: number;
  /** ドラッグ中に呼ばれる。範囲の丸めは呼び出し側 (ストア) が持つ */
  readonly onWidth: (width: number) => void;
}

export function Splitter({ width, onWidth }: SplitterProps) {
  // **掴んでいるかは ref で持つ。** state だと、押した直後に来る pointermove が
  // 再描画前の値 (false) を読んでしまい、最初の動きを取りこぼす
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      start.current = { x: event.clientX, width };
      setDragging(true);
      // ポインタを掴んでおく。速く動かしてもイベントが逃げない
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = start.current;
      if (from === null) return;
      onWidth(from.width + event.clientX - from.x);
    },
    [onWidth],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      className={classNames(styles.splitter, dragging && styles.dragging)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
