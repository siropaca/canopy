import type { RepoId } from "@/ipc/types";

import { useConsoleStore } from "./useConsoleStore";
import { useUiStore } from "./useUiStore";

/*
 * コンソールを開く操作。
 *
 * パネルの開閉は `useUiStore` (永続化する)、タブは `useConsoleStore` と
 * 分かれているので、**2 つをまたぐ操作はここに置く。**
 * features から 2 つのストアを順に叩くと、開いたのにタブが選ばれていない、
 * のような食い違いが features ごとに増える。
 */

/**
 * そのリポジトリの出力がいま見えているか。
 *
 * **定義はここ 1 本。** 赤いドットを立てるか (`store/results.ts`) と、
 * 開いた時点で消すか (`toggleConsolePanel`) が同じ判定を使う。
 * タブがまだ 1 つも無いときは、次の出力が最初のタブになるので「見えている」。
 */
export function isConsoleShowing(repoId: RepoId): boolean {
  if (!useUiStore.getState().consoleOpen) return false;
  const active = useConsoleStore.getState().activeTab;
  return active === null || active === repoId;
}

/** そのリポジトリのタブでコンソールを開く。トーストの `詳細を見る` から */
export function showConsoleFor(repoId: RepoId): void {
  useUiStore.getState().setConsoleOpen(true);
  // 開いた時点で赤いドットは消える (docs/specs/ui.md の「コンソール」)
  useConsoleStore.getState().openTab(repoId);
}

/**
 * パネルの開閉。サイドバーのボタンから。
 *
 * **開いたら、見えているタブの赤いドットを消す。** 閉じている間に届いた失敗には
 * 印が付くが、開いた時点でその出力は見えている。残すと消す操作が無い
 * (docs/specs/ui.md の「コンソール」)。
 */
export function toggleConsolePanel(): void {
  const ui = useUiStore.getState();
  const opening = !ui.consoleOpen;
  ui.toggleConsole();
  if (!opening) return;
  const console = useConsoleStore.getState();
  if (console.activeTab !== null) console.openTab(console.activeTab);
}
