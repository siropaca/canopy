import { useEffect, useRef } from "react";

import { classNames } from "@/shared/lib/classNames";

import styles from "./Dialog.module.css";

/*
 * ダイアログの共通の枠。形は docs/specs/ui.md の「ダイアログ」。
 *
 * - タイトルは対象名を含める。ウィンドウ操作のボタンは持たない
 * - ボタンは右下。`キャンセル` -> プライマリの順
 * - プライマリのラベルは操作名。`OK` にしない
 * - 背景のオーバーレイをクリックすると閉じる
 * - **Enter と Esc を受けるのはダイアログの中だけ** (docs/adr/0008-no-keyboard-shortcuts.md)
 */

interface DialogProps {
  readonly title: string;
  /** プライマリボタンのラベル。操作名にする */
  readonly confirmLabel: string;
  /** 破壊的な操作。ボタンを赤くする */
  readonly danger?: boolean;
  readonly wide?: boolean;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children: React.ReactNode;
}

export function Dialog({
  title,
  confirmLabel,
  danger = false,
  wide = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  // 入力欄が無いダイアログでも Esc が届くようにフォーカスを移す
  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    if (box.contains(document.activeElement)) return;
    box.focus();
  }, []);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        // 枠の中で押し始めたときは閉じない
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={classNames(styles.box, wide && styles.wide)}
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          // ボタンにフォーカスがあるときの Enter は、そのボタンに任せる
          if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault();
            if (!confirmDisabled) onConfirm();
          }
        }}
      >
        <div className={styles.titleBar}>
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.buttons}>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className={classNames(styles.primary, danger && styles.danger)}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
