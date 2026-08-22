import { useRef } from "react";

import styles from "./SearchBar.module.css";
import { useSearchQuery } from "./useSearchQuery";

/*
 * 検索欄。ツリー領域の最上部に固定する (docs/specs/ui.md の「検索」)。
 *
 * 絞り込みを遅らせる仕掛けは `useSearchQuery`。
 */

export function SearchBar() {
  const { text, setText, clear } = useSearchQuery();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.bar}>
      <SearchIcon />
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="ブランチまたはタグ"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {/* 空のときは出さない。押した先は入力欄なので、ツールチップは付けない */}
      {text !== "" && (
        <button
          type="button"
          className={styles.clear}
          aria-label="検索をクリア"
          onClick={() => {
            clear();
            // 続けて打てるようにフォーカスを戻す。ブラウザは押したボタンへ移してしまう
            inputRef.current?.focus();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** 虫眼鏡。色は `currentColor` で塗る (docs/design-system.md) */
function SearchIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5" cy="5" r="3.2" />
      <path d="M7.5 7.5 10.5 10.5" />
    </svg>
  );
}
