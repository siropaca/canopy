import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";

import { orderedRepos, useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

/**
 * ツリーに出す行。
 *
 * ツリーと詳細ペインが**同じ配列**を見る必要がある。詳細ペインは
 * 「画面に見えている選択」でしか内容を出さないので、可視の判定に使う
 * (docs/specs/ui.md の「詳細ペイン」)。
 */
export function useTreeRows(): RowNode[] {
  const repos = useRepoStore(useShallow(orderedRepos));
  const options = useUiStore(
    useShallow((state) => ({
      expanded: state.expanded,
      query: state.query,
      groupDirectories: state.groupDirectories,
      localOnly: state.localOnly,
    })),
  );

  return useMemo(() => flatten(repos, options), [repos, options]);
}
