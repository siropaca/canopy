import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { DetailPane } from "@/features/detail/DetailPane";
import { RepoTree, TreePane } from "@/features/repo-tree/RepoTree";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { StatusBar } from "@/features/status-bar/StatusBar";
import { canPullSelection } from "@/shared/lib/selection";
import { Splitter } from "@/shared/ui/Splitter";
import { addRepository, loadEverything, removeRepository } from "@/store/bootstrap";
import { usePersistUiState } from "@/store/persist";
import { collapseAll, expandAll, expandLocalOnly } from "@/store/treeActions";
import { useTreeRows } from "@/store/useTreeRows";
import { useUiStore } from "@/store/useUiStore";

import styles from "./App.module.css";

/*
 * 画面の組み立て。構成は docs/specs/ui.md の「画面の構成」。
 *
 * ヘッダーは持たない。詳細ペインは常に表示する。
 * 検索欄とコンソールはフェーズ 3。
 */

export function App() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadEverything().finally(() => {
      setLoaded(true);
    });
  }, []);
  // 読み込みが終わるまで保存しない。既定値で上書きしてしまう
  usePersistUiState(loaded);

  const rows = useTreeRows();
  const selectedKey = useUiStore((state) => state.selectedKey);
  const paneWidth = useUiStore((state) => state.paneWidth);
  const setPaneWidth = useUiStore((state) => state.setPaneWidth);
  const toggles = useUiStore(
    useShallow((state) => ({
      groupDirectories: state.groupDirectories,
      localOnly: state.localOnly,
      consoleOpen: state.consoleOpen,
    })),
  );

  // **画面に見えている**選択だけを詳細ペインとサイドバーに渡す
  // (docs/specs/ui.md の「詳細ペイン」)
  const selectedRow = useMemo(
    () => rows.find((row) => row.key === selectedKey) ?? null,
    [rows, selectedKey],
  );

  const onAddRepo = useCallback(() => {
    void addRepository();
  }, []);
  const onRemoveRepo = useCallback((repoId: string) => {
    void removeRepository(repoId);
  }, []);
  const onRemoveSelected = useCallback(() => {
    if (selectedRow?.kind === "repo") onRemoveRepo(selectedRow.repoId);
  }, [selectedRow, onRemoveRepo]);

  return (
    <div className={styles.app}>
      <div className={styles.split}>
        <Sidebar
          selectedKind={selectedRow?.kind ?? null}
          pullEnabled={canPullSelection(selectedRow)}
          groupDirectories={toggles.groupDirectories}
          localOnly={toggles.localOnly}
          consoleOpen={toggles.consoleOpen}
          onExpandLocal={expandLocalOnly}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onAddRepo={onAddRepo}
          onRemoveRepo={onRemoveSelected}
        />
        <TreePane>
          <RepoTree rows={rows} />
        </TreePane>
        <Splitter width={paneWidth} onWidth={setPaneWidth} />
        <DetailPane row={selectedRow} onRemoveRepo={onRemoveRepo} />
      </div>
      <StatusBar />
    </div>
  );
}
