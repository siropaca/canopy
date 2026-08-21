import { useCallback, useRef, useState } from "react";

import type { RowNode } from "@/ipc/types";
import { useCssVariable } from "@/shared/hooks/useCssVariable";
import { ROW_HEIGHT } from "@/shared/styles/rowHeight";
import { ScrollArea } from "@/shared/ui/ScrollArea";
import { VirtualRows } from "@/shared/ui/VirtualRows";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import styles from "./RepoTree.module.css";
import { TreeRow } from "./TreeRow";

/*
 * ツリー本体。
 *
 * 行は平坦にしてから仮想スクロールで描く (docs/adr/0004-virtual-scroll.md)。
 * スクロールするのは自前スクロールバーのビューポート
 * (docs/adr/0012-scrollbar-and-virtualization.md)。
 */

interface RepoTreeProps {
  /** 平坦にした行。組み立てるのは app 側 (詳細ペインと同じ配列を見る) */
  readonly rows: readonly RowNode[];
  readonly onActivate: (row: RowNode) => void;
  readonly onContextMenu: (row: RowNode, at: { readonly x: number; readonly y: number }) => void;
}

export function RepoTree({ rows, onActivate, onContextMenu }: RepoTreeProps) {
  const loadError = useRepoStore((state) => state.loadError);
  const loaded = useRepoStore((state) => state.loaded);
  const selectedKey = useUiStore((state) => state.selectedKey);
  const select = useUiStore((state) => state.select);
  const toggleExpanded = useUiStore((state) => state.toggleExpanded);

  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const onViewport = useCallback((element: HTMLElement | null) => {
    setViewport(element);
  }, []);

  const renderRow = useCallback(
    (row: RowNode) => (
      <TreeRow
        row={row}
        selected={row.key === selectedKey}
        onSelect={select}
        onToggle={toggleExpanded}
        onActivate={onActivate}
        onContextMenu={onContextMenu}
      />
    ),
    [selectedKey, select, toggleExpanded, onActivate, onContextMenu],
  );

  if (loadError !== null) {
    return (
      <div className={styles.empty}>
        <p className={styles.message}>{loadError}</p>
      </div>
    );
  }
  if (!loaded) {
    // 読み終える前は何も出さない。「登録されていません」が一瞬出るのを避ける
    return null;
  }
  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.message}>リポジトリが登録されていません</p>
      </div>
    );
  }

  return (
    <ScrollArea className={styles.scroll} onViewport={onViewport}>
      <VirtualRows
        items={rows}
        rowHeight={ROW_HEIGHT}
        scrollElement={viewport}
        keyOf={keyOf}
        renderRow={renderRow}
        revealKey={selectedKey ?? undefined}
      />
    </ScrollArea>
  );
}

function keyOf(row: RowNode): string {
  return row.key;
}

/** ツリーのペイン。幅は `UiState.pane_width` */
export function TreePane({ children }: { readonly children: React.ReactNode }) {
  const paneWidth = useUiStore((state) => state.paneWidth);
  const paneRef = useRef<HTMLDivElement>(null);
  // 幅を CSS 変数で渡す。JSX の `style` は使わない (docs/security.md)
  useCssVariable(paneRef, "--pane-width", `${paneWidth}px`);

  return (
    // tabIndex は選択色をフォーカスで変えるため。キーボード操作は持たない
    // (docs/adr/0008-no-keyboard-shortcuts.md)
    <div className={styles.pane} ref={paneRef} tabIndex={0} data-tree-pane="">
      {children}
    </div>
  );
}
