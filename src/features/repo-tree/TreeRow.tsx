import { memo } from "react";

import type { RepoRow, RowNode } from "@/ipc/types";
import { classNames } from "@/shared/lib/classNames";
import { canCheckout, hasMenu, isFoldable } from "@/shared/lib/selection";
import { repoTotals } from "@/shared/lib/totals";
import {
  AheadIcon,
  BehindIcon,
  BranchIcon,
  ChevronIcon,
  CurrentBranchIcon,
  FolderIcon,
  IconSpacer,
  TagIcon,
} from "@/shared/ui/icons";

import { Indicators } from "./Indicators";
import styles from "./TreeRow.module.css";

/*
 * ツリーの 1 行。
 *
 * **インデントは `data-depth` 属性 + CSS のセレクタで出す。**
 * モックの `style="--d:N"` は CSP で無効になる (docs/security.md)。
 */

interface TreeRowProps {
  readonly row: RowNode;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (key: string) => void;
  /** ダブルクリック。折りたためない行はチェックアウト (docs/specs/ui.md の「操作」) */
  readonly onActivate: (row: RowNode) => void;
  readonly onContextMenu: (row: RowNode, at: { readonly x: number; readonly y: number }) => void;
}

export const TreeRow = memo(function TreeRow({
  row,
  selected,
  onSelect,
  onToggle,
  onActivate,
  onContextMenu,
}: TreeRowProps) {
  // 実行中の行は薄くする。スピナーは出さない (docs/specs/ui.md の「実行中の扱い」)
  const dimmed =
    row.running || (row.kind === "repo" && (row.repo.status === "error" || !row.matched));
  const className = classNames(
    styles.row,
    row.kind === "repo" && styles.heading,
    selected && styles.selected,
    dimmed && styles.dimmed,
  );

  return (
    <div
      className={className}
      data-depth={row.depth}
      data-kind={row.kind}
      onMouseDown={() => {
        onSelect(row.key);
      }}
      onDoubleClick={() => {
        if (isFoldable(row)) {
          onToggle(row.key);
          return;
        }
        // 実行中と `⧉` 付きは `canCheckout` が false を返す
        if (canCheckout(row)) onActivate(row);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect(row.key);
        // 括りとディレクトリではメニューを出さない (選択だけ)
        if (hasMenu(row)) onContextMenu(row, { x: event.clientX, y: event.clientY });
      }}
    >
      <RowContent row={row} onToggle={onToggle} />
    </div>
  );
});

interface RowContentProps {
  readonly row: RowNode;
  readonly onToggle: (key: string) => void;
}

function RowContent({ row, onToggle }: RowContentProps) {
  switch (row.kind) {
    case "repo":
      return (
        <>
          <Chevron open={row.expanded} rowKey={row.key} onToggle={onToggle} />
          <span className={styles.name}>{row.repo.name}</span>
          <span className={styles.spring} />
          <RepoNote row={row} />
        </>
      );
    case "section":
      return (
        <>
          <Chevron open={row.expanded} rowKey={row.key} onToggle={onToggle} />
          <span className={styles.name}>{row.label}</span>
        </>
      );
    case "directory":
      return (
        <>
          <Chevron open={row.expanded} rowKey={row.key} onToggle={onToggle} />
          <FolderIcon />
          <span className={styles.name}>{row.label}</span>
        </>
      );
    case "branch":
      return (
        <>
          <IconSpacer />
          {row.branch.is_current ? <CurrentBranchIcon /> : <BranchIcon />}
          <span className={styles.name} title={row.branch.name}>
            {row.label}
          </span>
          <Indicators
            dirtyCount={row.dirtyCount}
            behind={row.branch.behind}
            ahead={row.branch.ahead}
            gone={row.branch.upstream_gone}
            worktreeName={row.worktreeName}
          />
        </>
      );
    case "remote":
      return (
        <>
          <IconSpacer />
          <BranchIcon />
          <span className={styles.name} title={row.reference.name}>
            {row.label}
          </span>
        </>
      );
    case "tag":
      return (
        <>
          <IconSpacer />
          <TagIcon />
          <span className={styles.name} title={row.reference.name}>
            {row.label}
          </span>
        </>
      );
  }
}

interface ChevronProps {
  readonly open: boolean;
  readonly rowKey: string;
  readonly onToggle: (key: string) => void;
}

/**
 * シェブロン。**v1 で唯一のシングルクリックでの開閉手段**
 * (docs/specs/ui.md の「操作」)。
 */
function Chevron({ open, rowKey, onToggle }: ChevronProps) {
  return (
    <span
      className={styles.chevron}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        onToggle(rowKey);
      }}
    >
      <ChevronIcon open={open} />
    </span>
  );
}

/**
 * リポジトリ見出しの右側。
 *
 * 状態によって出すものが変わる (docs/specs/ui.md の「読み込み中とエラー」)。
 * サマリのバッジは**折りたたんでいるときだけ**出す。
 */
function RepoNote({ row }: { readonly row: RepoRow }) {
  const { repo } = row;
  if (repo.status === "loading") {
    return <span className={styles.note}>読み込み中</span>;
  }
  if (repo.status === "error") {
    return <span className={styles.note}>{repo.error}</span>;
  }
  if (repo.snapshot === null) return null;

  const totals = repoTotals(repo.snapshot);
  const detached = repo.snapshot.head.kind === "detached";
  return (
    <>
      {detached && <span className={styles.note}>detached: {repo.snapshot.head.name}</span>}
      {!row.expanded && (
        <>
          {totals.dirty > 0 && (
            <span className={classNames(styles.badge, styles.badgeDirty)}>●{totals.dirty}</span>
          )}
          {totals.behind > 0 && (
            <span className={classNames(styles.badge, styles.badgeBehind)}>
              <BehindIcon />
              {totals.behind}
            </span>
          )}
          {totals.ahead > 0 && (
            <span className={classNames(styles.badge, styles.badgeAhead)}>
              <AheadIcon />
              {totals.ahead}
            </span>
          )}
        </>
      )}
    </>
  );
}
