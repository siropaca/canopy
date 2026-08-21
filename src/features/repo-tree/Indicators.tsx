import { classNames } from "@/shared/lib/classNames";
import { AheadIcon, BehindIcon, WorktreeIcon } from "@/shared/ui/icons";

import styles from "./Indicators.module.css";

/*
 * ブランチ行のインジケーター。
 *
 * 並びは 未コミット (オレンジ) -> behind (青) -> ahead (緑) -> gone -> ワークツリー
 * (docs/design-system.md、docs/specs/ui.md の「ブランチ行」)。
 * 0 は出さない。
 */

interface IndicatorsProps {
  readonly dirtyCount: number;
  readonly behind: number;
  readonly ahead: number;
  readonly gone: boolean;
  readonly worktreeName: string | null;
}

export function Indicators({ dirtyCount, behind, ahead, gone, worktreeName }: IndicatorsProps) {
  return (
    <>
      {dirtyCount > 0 && (
        <span className={styles.dirty} title={`未コミット ${dirtyCount} ファイル`}>
          ●{dirtyCount}
        </span>
      )}
      {behind > 0 && (
        <span
          className={classNames(styles.track, styles.behind)}
          title={`${behind} コミット遅れている`}
        >
          <BehindIcon />
          {behind}
        </span>
      )}
      {ahead > 0 && (
        <span
          className={classNames(styles.track, styles.ahead)}
          title={`${ahead} コミット進んでいる`}
        >
          <AheadIcon />
          {ahead}
        </span>
      )}
      {gone && (
        <span className={styles.gone} title="追跡ブランチが消えている">
          gone
        </span>
      )}
      {worktreeName !== null && (
        <span
          className={styles.worktree}
          title={`ワークツリー ${worktreeName} にチェックアウト済み`}
        >
          <WorktreeIcon />
          <span className={styles.worktreeName}>{worktreeName}</span>
        </span>
      )}
    </>
  );
}
