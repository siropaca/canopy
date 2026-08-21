import { classNames } from "@/shared/lib/classNames";

import styles from "./icons.module.css";

/*
 * ツリーで使うアイコン。
 *
 * すべてインラインの SVG。色は class で当てて SVG には書かない。
 * 意味が違うものに同じ形を使わない (docs/design-system.md)。
 * 形はモック (docs/mock/tree.tmpl.html の `IC`) と同じパス。
 */

interface ChevronProps {
  readonly open: boolean;
}

/** 開閉のシェブロン。閉じているときは 90 度回す */
export function ChevronIcon({ open }: ChevronProps) {
  return (
    <svg
      className={classNames(styles.chevron, !open && styles.closed)}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M3.4 4.7 6 7.4l2.6-2.7" />
    </svg>
  );
}

/** シェブロンが無い行の詰め物。アイコンの位置を揃える */
export function IconSpacer() {
  return <span className={styles.spacer} />;
}

/** スラッシュで畳んだディレクトリ */
export function FolderIcon() {
  return (
    <svg className={styles.folder} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.2 9.8V2.6h3.1l1.1 1.5h5.4v5.7z" />
    </svg>
  );
}

/** 通常のブランチ */
export function BranchIcon() {
  return (
    <svg className={styles.branch} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="3.6" cy="2.4" r="1.3" />
      <circle cx="3.6" cy="9.6" r="1.3" />
      <path d="M3.6 3.7v4.6" />
      <path d="M3.6 6h2.9a1.7 1.7 0 0 0 1.7-1.7V3.7" />
      <circle cx="8.2" cy="2.4" r="1.3" />
    </svg>
  );
}

/** 現在のブランチ。オレンジの斜めのタグ */
export function CurrentBranchIcon() {
  return (
    <svg className={styles.current} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6.6 1.4h4v4l-5.1 5.1-4-4z" />
      <circle cx="8.7" cy="3.3" r=".95" />
    </svg>
  );
}

/** git のタグ。横向きのタグ */
export function TagIcon() {
  return (
    <svg className={styles.tag} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 6 5.2 2.2h5.3v7.6H5.2z" />
      <circle cx="8.2" cy="6" r=".95" />
    </svg>
  );
}

/** 別のワークツリーにチェックアウトされている */
export function WorktreeIcon() {
  return (
    <svg className={styles.worktree} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.4 3.4h6.2v6.2H1.4z" />
      <path d="M4.4 3.4V1.4h6.2v6.2h-2" />
    </svg>
  );
}

/** behind。取り込むもの */
export function BehindIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M9.3 2.7 4.2 7.8" />
      <path d="M4.2 5.2v2.6h2.6" />
    </svg>
  );
}

/** ahead。出すもの */
export function AheadIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.7 9.3 7.8 4.2" />
      <path d="M7.8 6.8V4.2H5.2" />
    </svg>
  );
}
