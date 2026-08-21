import { useEffect, useRef, useState } from "react";

import { Dialog } from "./Dialog";
import styles from "./RenameDialog.module.css";

/*
 * ブランチ名の変更。形は docs/specs/ui.md の「ブランチ名の変更」。
 *
 * 名前の検証は Rust 側で `git check-ref-format` を通す (docs/security.md)。
 * ここでは空と「変えていない」だけを止める。
 */

interface RenameDialogProps {
  readonly name: string;
  readonly onRename: (newName: string) => void;
  readonly onCancel: () => void;
}

export function RenameDialog({ name, onRename, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const unchanged = trimmed === "" || trimmed === name;

  return (
    <Dialog
      title={`ブランチ ${name} の名前変更`}
      confirmLabel="名前の変更"
      confirmDisabled={unchanged}
      onConfirm={() => {
        onRename(trimmed);
      }}
      onCancel={onCancel}
    >
      <div className={styles.row}>
        <label htmlFor="rename-input">ブランチ名:</label>
        <input
          id="rename-input"
          className={styles.input}
          type="text"
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </div>
    </Dialog>
  );
}
