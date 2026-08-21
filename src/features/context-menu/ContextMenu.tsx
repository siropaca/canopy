import { useCallback, useEffect, useRef, useState } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./ContextMenu.module.css";
import type { MenuAction, MenuItem } from "./menuItems";

/*
 * 右クリックメニュー。
 *
 * 見え方はモック (docs/mock/tree.tmpl.html の `.menu`)。
 * 位置は CSS 変数で渡す。JSX の `style` は使わない (docs/security.md)。
 *
 * v2 の項目と無効な項目はグレーで置く。押しても何も起きない。
 */

/** メニューを出す位置 */
export interface MenuPlacement {
  readonly x: number;
  readonly y: number;
}

interface ContextMenuProps {
  readonly items: readonly MenuItem[];
  readonly at: MenuPlacement;
  readonly onAction: (action: MenuAction) => void;
  readonly onClose: () => void;
}

export function ContextMenu({ items, at, onAction, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // メニューの外を押したら閉じる。capture で拾って、下の行に選択を渡さない
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
    };
  }, [onClose]);

  const run = useCallback(
    (action: MenuAction) => {
      onAction(action);
      onClose();
    },
    [onAction, onClose],
  );

  return <Panel items={items} at={at} onRun={run} rootRef={rootRef} />;
}

interface PanelProps {
  readonly items: readonly MenuItem[];
  readonly at: MenuPlacement;
  readonly onRun: (action: MenuAction) => void;
  readonly rootRef?: React.RefObject<HTMLDivElement | null>;
}

/** メニュー 1 枚。サブメニューも同じものを使う */
function Panel({ items, at, onRun, rootRef }: PanelProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = rootRef ?? ownRef;
  const [open, setOpen] = useState<{ readonly index: number; readonly at: MenuPlacement } | null>(
    null,
  );
  useClampedPosition(ref, at);

  return (
    <div className={styles.menu} ref={ref} data-menu="">
      {items.map((item, index) => (
        <Row
          key={`${item.kind}-${index}`}
          item={item}
          onRun={onRun}
          onHover={(placement) => {
            setOpen(placement === null ? null : { index, at: placement });
          }}
        />
      ))}
      {open !== null && submenuOf(items[open.index]) !== null && (
        <Panel items={submenuOf(items[open.index]) ?? []} at={open.at} onRun={onRun} />
      )}
    </div>
  );
}

function submenuOf(item: MenuItem | undefined): readonly MenuItem[] | null {
  return item?.kind === "submenu" ? item.items : null;
}

interface RowProps {
  readonly item: MenuItem;
  readonly onRun: (action: MenuAction) => void;
  readonly onHover: (at: MenuPlacement | null) => void;
}

function Row({ item, onRun, onHover }: RowProps) {
  if (item.kind === "separator") {
    return <div className={styles.separator} />;
  }
  if (item.kind === "title") {
    return <div className={styles.title}>{item.label}</div>;
  }
  if (item.kind === "submenu") {
    return (
      <button
        type="button"
        className={styles.item}
        onMouseEnter={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onHover({ x: box.right - 3, y: box.top - 5 });
        }}
      >
        <span>{item.label}</span>
        <span className={styles.arrow}>›</span>
      </button>
    );
  }
  if (item.kind === "v2" || item.disabled) {
    return (
      <button
        type="button"
        className={classNames(styles.item, styles.off)}
        disabled
        onMouseEnter={() => {
          onHover(null);
        }}
      >
        <span>{item.label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.item}
      onMouseEnter={() => {
        onHover(null);
      }}
      onClick={() => {
        onRun(item.action);
      }}
    >
      <span>{item.label}</span>
      {item.value !== undefined && <span className={styles.value}>{item.value}</span>}
    </button>
  );
}

/**
 * 画面の外にはみ出さない位置に置く。
 *
 * 寸法は描いた後にしか分からないので、`useLayoutEffect` で測ってから
 * CSS 変数を書く。
 */
function useClampedPosition(ref: React.RefObject<HTMLDivElement | null>, at: MenuPlacement): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const left = Math.max(0, Math.min(at.x, window.innerWidth - element.offsetWidth - 4));
    const top = Math.max(0, Math.min(at.y, window.innerHeight - element.offsetHeight - 4));
    element.style.setProperty("--menu-left", `${left}px`);
    element.style.setProperty("--menu-top", `${top}px`);
  }, [ref, at]);
}
