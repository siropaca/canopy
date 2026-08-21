import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useCallback, type ReactNode } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./ScrollArea.module.css";

/*
 * 自前のスクロールバー。
 *
 * **ネイティブのスクロールバーはどこにも出さない** (docs/adr/0012-scrollbar-and-virtualization.md)。
 * 仮想化のスクロール要素は、この中のビューポートになるので `onViewport` で渡す。
 * ツリーとコンソールで同じものを使う。
 *
 * **`defer` を付けない。** 付けると初期化が requestIdleCallback 待ちになり、
 * ビューポートが出来るまで仮想リストが 1 行も描けない。
 * 非アクティブなタブでは idle コールバックが来ないので、ツリーが空のまま止まる (実測)。
 */

// クラス名が取れないと、寸法の指定が届かず幅 0 のスクロールバーになる。
// 黙って見えなくなるより、起動時に落とす
const THEME = styles.theme;
if (THEME === undefined) {
  throw new Error("ScrollArea.module.css に .theme が無い");
}

const OPTIONS = {
  scrollbars: {
    // 触っているあいだだけ濃くする
    autoHide: "leave" as const,
    autoHideDelay: 500,
    // つまみの寸法と色。CSS Modules のクラスをそのままテーマ名として渡す
    theme: THEME,
  },
  overflow: { x: "hidden" as const, y: "scroll" as const },
};

interface ScrollAreaProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** スクロールする要素。仮想化に渡すために上へ返す */
  readonly onViewport?: (viewport: HTMLElement | null) => void;
}

export function ScrollArea({ children, className, onViewport }: ScrollAreaProps) {
  const initialized = useCallback(
    (instance: OverlayScrollbars) => {
      onViewport?.(instance.elements().viewport);
    },
    [onViewport],
  );
  const destroyed = useCallback(() => {
    onViewport?.(null);
  }, [onViewport]);

  return (
    <OverlayScrollbarsComponent
      className={classNames(styles.area, className)}
      options={OPTIONS}
      events={{ initialized, destroyed }}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
