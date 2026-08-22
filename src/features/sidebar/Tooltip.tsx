import { useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "./Tooltip.module.css";

/*
 * サイドバーのアイコンボタンに出す吹き出し。
 *
 * 見え方と位置はモック (docs/mock/tree.tmpl.html の `.tip`)。
 * ホバーしてから 500ms 遅らせて出し、外したら即座に消す。
 *
 * **ホバーは包んだ側で受ける。** 無効なボタンはマウスイベントを出さないので、
 * ボタンに付けると無効なときだけ出なくなる。ツールチップの有無は
 * 有効・無効で変えない (docs/specs/ui.md の「サイドバー」)。
 *
 * 位置は CSS 変数で渡す。JSX の `style` は使わない (docs/security.md)。
 *
 * 置き場所は sidebar の中。使うのがサイドバーだけの間は上げない
 * (docs/architecture.md の「ディレクトリ」)。
 */

/** ホバーしてから吹き出しを出すまで (ms) */
const DELAY_MS = 500;

/** ボタンの右端から吹き出しまでの間隔 (px) */
const GAP = 6;

interface TooltipProps {
  /** 出す文言。v2 のボタンは `(v2)` まで含めて渡す */
  readonly label: string;
  readonly children: React.ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);

  // 出す方だけ遅らせる。消す方は下のハンドラで即座にやる
  useEffect(() => {
    if (!hovered) return;
    const timer = setTimeout(() => {
      setOpen(true);
    }, DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [hovered]);

  return (
    <span
      className={styles.anchor}
      ref={anchorRef}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setOpen(false);
      }}
    >
      {children}
      {open && <Bubble anchorRef={anchorRef} label={label} />}
    </span>
  );
}

interface BubbleProps {
  readonly anchorRef: React.RefObject<HTMLSpanElement | null>;
  readonly label: string;
}

/**
 * 吹き出し本体。
 *
 * 縦中央に置くには自分の高さが要る。描いた後にしか分からないので、
 * `useLayoutEffect` で測ってから CSS 変数を書く。`useEffect` はペイントの後に走るので、
 * 出た最初の 1 フレームだけ左上に描かれる (useCssVariable と同じ理由)。
 */
function Bubble({ anchorRef, label }: BubbleProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const bubble = ref.current;
    const anchor = anchorRef.current;
    if (bubble === null || anchor === null) return;
    const box = anchor.getBoundingClientRect();
    bubble.style.setProperty("--tip-left", `${box.right + GAP}px`);
    bubble.style.setProperty("--tip-top", `${box.top + (box.height - bubble.offsetHeight) / 2}px`);
  }, [anchorRef, label]);

  return (
    <span className={styles.tip} ref={ref} role="tooltip">
      {label}
    </span>
  );
}
