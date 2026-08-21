import { useCallback, useMemo, useState } from "react";

import type { PushPreview } from "@/ipc/generated/PushPreview";
import type { BranchRow, RowNode } from "@/ipc/types";
import type { MenuPlacement } from "@/features/context-menu/ContextMenu";
import type { MenuAction } from "@/features/context-menu/menuItems";
import { renamedLeafKey } from "@/shared/lib/treeKeys";
import { addRepository, removeRepository } from "@/store/bootstrap";
import {
  checkoutAndPullRow,
  checkoutPreviousBranch,
  checkoutRow,
  copyToClipboard,
  fetchAllRepositories,
  fetchRepository,
  loadPushPreview,
  openRepositoryInTerminal,
  pullRow,
  pushBranch,
  renameBranch,
  revealRepository,
} from "@/store/opsActions";
import { useUiStore } from "@/store/useUiStore";

/*
 * 行に対する操作の入口。
 *
 * メニューとダイアログの開閉、項目から操作への割り振り、確定の処理をここに集める。
 * 実行そのものは `store/opsActions.ts`、有効条件は `shared/lib/selection.ts`。
 *
 * **掴むのは行ではなく鍵。** 開いた瞬間の `RowNode` を持ち続けると、
 * 一括フェッチが始まっても「実行中」が古いままで、無効にしたはずの項目が押せる。
 * 選択 (`store/useSelectedRow.ts`) と同じく、毎回 `rows` から解き直す。
 */

/** いま開いているメニュー。行は解き直したもの */
export interface OpenMenu {
  readonly row: RowNode;
  readonly at: MenuPlacement;
}

/** いま開いているダイアログ。行は解き直したもの */
export type OpenDialog =
  | { readonly kind: "rename"; readonly row: BranchRow }
  | {
      readonly kind: "push";
      readonly row: BranchRow;
      /** `null` は読み込み中 */
      readonly preview: PushPreview | null;
    };

export interface RowActions {
  readonly menu: OpenMenu | null;
  readonly dialog: OpenDialog | null;
  readonly openMenu: (row: RowNode, at: MenuPlacement) => void;
  readonly closeMenu: () => void;
  readonly closeDialog: () => void;
  /** ダブルクリック。折りたためない行はチェックアウト */
  readonly activate: (row: RowNode) => void;
  readonly run: (action: MenuAction, row: RowNode) => void;
  readonly openPush: (row: BranchRow) => void;
  readonly openRename: (row: BranchRow) => void;
  /** 名前の変更を確定する。成功したら新しい名前の行を選択したままにする */
  readonly submitRename: (newName: string) => void;
  /** プッシュを確定する。`lease` はダイアログで見せていた sha */
  readonly submitPush: (lease: string | null) => void;
}

/** 開いているものを鍵で覚える。行は `rows` から解き直す */
interface MenuState {
  readonly key: string;
  readonly at: MenuPlacement;
}

interface DialogState {
  readonly kind: "rename" | "push";
  readonly key: string;
  /** プッシュのときだけ。`null` は読み込み中 */
  readonly preview: PushPreview | null;
}

export function useRowActions(rows: readonly RowNode[]): RowActions {
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [dialogState, setDialogState] = useState<DialogState | null>(null);

  const menu = useMemo<OpenMenu | null>(() => {
    if (menuState === null) return null;
    const row = rows.find((candidate) => candidate.key === menuState.key);
    // 行が消えた (リストから削除、折りたたみ) なら出さない
    return row === undefined ? null : { row, at: menuState.at };
  }, [rows, menuState]);

  const dialog = useMemo<OpenDialog | null>(() => {
    if (dialogState === null) return null;
    const row = rows.find((candidate) => candidate.key === dialogState.key);
    if (row === undefined || row.kind !== "branch") return null;
    return dialogState.kind === "rename"
      ? { kind: "rename", row }
      : { kind: "push", row, preview: dialogState.preview };
  }, [rows, dialogState]);

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);
  const closeDialog = useCallback(() => {
    setDialogState(null);
  }, []);
  const openMenu = useCallback((row: RowNode, at: MenuPlacement) => {
    setMenuState({ key: row.key, at });
  }, []);

  const openRename = useCallback((row: BranchRow) => {
    setDialogState({ kind: "rename", key: row.key, preview: null });
  }, []);

  /** プッシュダイアログ。コミット一覧は開いてから読む */
  const openPush = useCallback((row: BranchRow) => {
    setDialogState({ kind: "push", key: row.key, preview: null });
    void loadPushPreview(row.repoId, row.branch.name).then((preview) => {
      if (preview === null) {
        // 読めなかった理由は結果の欄に出ている。開いたままにしない
        setDialogState(null);
        return;
      }
      setDialogState((current) =>
        current?.kind === "push" && current.key === row.key ? { ...current, preview } : current,
      );
    });
  }, []);

  const activate = useCallback((row: RowNode) => {
    void checkoutRow(row);
  }, []);

  const submitRename = useCallback(
    (newName: string) => {
      if (dialog?.kind !== "rename") return;
      const { row } = dialog;
      closeDialog();
      void renameBranch(row.repoId, row.branch.name, newName).then((result) => {
        // 名前を変更したら、新しい名前の行を選択したままにする
        if (result.ok) useUiStore.getState().select(renamedLeafKey(row.key, newName));
      });
    },
    [dialog, closeDialog],
  );

  const submitPush = useCallback(
    (lease: string | null) => {
      if (dialog?.kind !== "push") return;
      const { row } = dialog;
      closeDialog();
      void pushBranch(row.repoId, row.branch.name, lease);
    },
    [dialog, closeDialog],
  );

  const run = useCallback(
    (action: MenuAction, row: RowNode) => {
      switch (action.type) {
        case "pull":
          void pullRow(row);
          return;
        case "checkout":
          void checkoutRow(row);
          return;
        case "checkoutAndPull":
          void checkoutAndPullRow(row);
          return;
        case "push":
          if (row.kind === "branch") openPush(row);
          return;
        case "rename":
          if (row.kind === "branch") openRename(row);
          return;
        case "fetchRepo":
          void fetchRepository(row.repoId);
          return;
        case "fetchAll":
          void fetchAllRepositories();
          return;
        case "checkoutPrevious":
          void checkoutPreviousBranch(row.repoId);
          return;
        case "reveal":
          void revealRepository(row.repoId);
          return;
        case "terminal":
          void openRepositoryInTerminal(row.repoId);
          return;
        case "addRepo":
          void addRepository();
          return;
        case "removeRepo":
          void removeRepository(row.repoId);
          return;
        case "copy":
          void copyToClipboard(row.repoId, action.text);
          return;
      }
    },
    [openPush, openRename],
  );

  return {
    menu,
    dialog,
    openMenu,
    closeMenu,
    closeDialog,
    activate,
    run,
    openPush,
    openRename,
    submitRename,
    submitPush,
  };
}
