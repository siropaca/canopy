import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ContextMenu } from "@/features/context-menu/ContextMenu";
import { menuItemsFor } from "@/features/context-menu/menuItems";
import { PushDialog } from "@/features/dialog/PushDialog";
import { RenameDialog } from "@/features/dialog/RenameDialog";
import { DetailPane, type DetailActions } from "@/features/detail/DetailPane";
import { RepoTree, TreePane } from "@/features/repo-tree/RepoTree";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { StatusBar } from "@/features/status-bar/StatusBar";
import { canFetch, canPull, canRemoveRepo } from "@/shared/lib/selection";
import { Splitter } from "@/shared/ui/Splitter";
import { addRepository, loadEverything, removeRepository } from "@/store/bootstrap";
import { listenForRepoUpdates } from "@/store/events";
import {
  checkoutAndPullRow,
  checkoutRow,
  copyToClipboard,
  fetchAllRepositories,
  fetchRepository,
  pullRow,
} from "@/store/opsActions";
import { usePersistUiState } from "@/store/persist";
import { collapseAll, expandAll, expandLocalOnly } from "@/store/treeActions";
import { useRepoStore } from "@/store/useRepoStore";
import { useSelectedRow } from "@/store/useSelectedRow";
import { useTreeRows } from "@/store/useTreeRows";
import { useUiStore } from "@/store/useUiStore";

import styles from "./App.module.css";
import { useRowActions } from "./useRowActions";

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

  // 一括フェッチの結果はイベントで届く。購読の中身は store/events.ts
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    listenForRepoUpdates()
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch((error: unknown) => {
        // 握りつぶさない。トーストはフェーズ 3 なので、いまはここだけが出力先。
        // 購読できていないときは一括フェッチが 1 件ずつ投げる形に落ちる
        console.error("canopy: イベントを購読できませんでした", error);
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const rows = useTreeRows();
  // **画面に見えている**選択だけを詳細ペインとサイドバーに渡す
  const selectedRow = useSelectedRow(rows);
  const paneWidth = useUiStore((state) => state.paneWidth);
  const setPaneWidth = useUiStore((state) => state.setPaneWidth);
  const toggles = useUiStore(
    useShallow((state) => ({
      groupDirectories: state.groupDirectories,
      localOnly: state.localOnly,
      consoleOpen: state.consoleOpen,
    })),
  );

  const actions = useRowActions(rows);
  const menuRepo = useRepoStore((state) =>
    actions.menu === null ? undefined : state.byId.get(actions.menu.row.repoId),
  );
  const dialogRepo = useRepoStore((state) =>
    actions.dialog === null ? undefined : state.byId.get(actions.dialog.row.repoId),
  );

  const onAddRepo = useCallback(() => {
    void addRepository();
  }, []);
  const onRemoveRepo = useCallback((repoId: string) => {
    void removeRepository(repoId);
  }, []);

  /** サイドバーのフェッチ。選択があればそのリポジトリ、無ければ全リポジトリ */
  const onFetch = useCallback(() => {
    if (selectedRow === null) {
      void fetchAllRepositories();
      return;
    }
    void fetchRepository(selectedRow.repoId);
  }, [selectedRow]);

  const onPullSelection = useCallback(() => {
    if (selectedRow !== null) void pullRow(selectedRow);
  }, [selectedRow]);

  const detailActions = useMemo<DetailActions>(
    () => ({
      onFetch: (row) => {
        void fetchRepository(row.repoId);
      },
      onPull: (row) => {
        void pullRow(row);
      },
      onCheckout: (row) => {
        void checkoutRow(row);
      },
      onCheckoutAndPull: (row) => {
        void checkoutAndPullRow(row);
      },
      onPush: actions.openPush,
      onCopy: (repoId, text) => {
        void copyToClipboard(repoId, text);
      },
      onRemoveRepo,
    }),
    [actions.openPush, onRemoveRepo],
  );

  return (
    <div className={styles.app}>
      <div className={styles.split}>
        <Sidebar
          selectedKind={selectedRow?.kind ?? null}
          pullEnabled={canPull(selectedRow)}
          fetchEnabled={canFetch(selectedRow)}
          groupDirectories={toggles.groupDirectories}
          localOnly={toggles.localOnly}
          consoleOpen={toggles.consoleOpen}
          onFetch={onFetch}
          onPull={onPullSelection}
          onExpandLocal={expandLocalOnly}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onAddRepo={onAddRepo}
          onRemoveRepo={() => {
            if (canRemoveRepo(selectedRow) && selectedRow !== null) {
              onRemoveRepo(selectedRow.repoId);
            }
          }}
        />
        <TreePane>
          <RepoTree rows={rows} onActivate={actions.activate} onContextMenu={actions.openMenu} />
        </TreePane>
        <Splitter width={paneWidth} onWidth={setPaneWidth} />
        <DetailPane row={selectedRow} actions={detailActions} />
      </div>
      <StatusBar />

      {actions.menu !== null && menuRepo !== undefined && (
        <ContextMenu
          items={menuItemsFor(actions.menu.row, menuRepo)}
          at={actions.menu.at}
          onAction={(action) => {
            if (actions.menu !== null) actions.run(action, actions.menu.row);
          }}
          onClose={actions.closeMenu}
        />
      )}

      {actions.dialog?.kind === "rename" && (
        <RenameDialog
          name={actions.dialog.row.branch.name}
          onRename={actions.submitRename}
          onCancel={actions.closeDialog}
        />
      )}

      {actions.dialog?.kind === "push" && dialogRepo !== undefined && (
        <PushDialog
          repoName={dialogRepo.name}
          branch={actions.dialog.row.branch}
          preview={actions.dialog.preview}
          onPush={actions.submitPush}
          onCancel={actions.closeDialog}
        />
      )}
    </div>
  );
}
