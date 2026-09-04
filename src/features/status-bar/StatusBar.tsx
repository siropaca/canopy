import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { activityLabel } from "@/shared/lib/activity";
import { summarize } from "@/shared/lib/totals";
import { AheadIcon, BehindIcon, SpinnerIcon } from "@/shared/ui/icons";
import { bulkFetchProgress, useBulkFetchStore } from "@/store/useBulkFetchStore";
import { orderedRepos, useRepoStore } from "@/store/useRepoStore";

import styles from "./StatusBar.module.css";

/*
 * 下端の集計と、いま何をしているか。
 * 数え方は docs/specs/ui.md の「ステータスバー」。
 * 計算は shared/lib/totals.ts と shared/lib/activity.ts、ここは表示だけ。
 */

/** 揃うまで出す文字。0 -> 途中 -> 確定と 2 回跳ねさせない */
const PENDING = "-";

export function StatusBar() {
  const repos = useRepoStore(useShallow(orderedRepos));
  const loaded = useRepoStore((state) => state.loaded);
  // 読み終えるまでは合計を出さない。0 を挟むと 2 回跳ねる
  const summary = useMemo(() => (loaded ? summarize(repos) : null), [loaded, repos]);
  const activity = useActivity();

  return (
    <div className={styles.bar}>
      {activity !== null && (
        <span className={styles.activity}>
          <SpinnerIcon />
          {activity}
        </span>
      )}
      <span>{loaded ? repos.length : PENDING} リポジトリ</span>
      <span>
        ローカル {summary === null ? PENDING : summary.local} / リモート{" "}
        {summary === null ? PENDING : summary.remote}
      </span>
      <span className={styles.behind}>
        <BehindIcon />
        {summary === null ? PENDING : `${summary.behind} (${summary.behindRepos} repo)`}
      </span>
      <span className={styles.ahead}>
        <AheadIcon />
        {summary === null ? PENDING : `${summary.ahead} (${summary.aheadRepos} repo)`}
      </span>
      <span className={styles.dirty}>
        未コミット {summary === null ? PENDING : `${summary.dirtyRepos} repo`}
      </span>
      <span className={styles.worktree}>
        worktree {summary === null ? PENDING : summary.worktrees}
      </span>
    </div>
  );
}

/**
 * いま出す 1 行 (docs/adr/0023-progress-in-the-status-bar.md)。
 *
 * **組み立ては `shared/lib/activity.ts` の 1 本。** ここは読むだけ。
 */
function useActivity(): string | null {
  const running = useRepoStore((state) => state.running);
  const reading = useRepoStore((state) => state.reading);
  const byId = useRepoStore((state) => state.byId);
  // 走っているかの判定は `useBulkFetchStore` の 1 本を通す
  const bulk = useBulkFetchStore(useShallow(bulkFetchProgress));

  return useMemo(
    () =>
      activityLabel({
        running,
        reading,
        bulk,
        nameOf: (repoId) => byId.get(repoId)?.name,
      }),
    [running, reading, bulk, byId],
  );
}
