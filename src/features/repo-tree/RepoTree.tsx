import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import type { RowNode } from "@/ipc/types";
import { useCssVariable } from "@/shared/hooks/useCssVariable";
import { repoBlocks } from "@/shared/lib/reorder";
import { stickyHeaderAt } from "@/shared/lib/stickyHeader";
import { ROW_HEIGHT } from "@/shared/styles/rowHeight";
import { ScrollArea } from "@/shared/ui/ScrollArea";
import { VirtualRows } from "@/shared/ui/VirtualRows";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import styles from "./RepoTree.module.css";
import { SearchBar } from "./SearchBar";
import { TreeRow } from "./TreeRow";
import { useRepoDrag } from "./useRepoDrag";

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

  // 並び替え。ドロップ位置は行のインデックスから決める
  // (docs/adr/0019-reorder-without-dnd-kit.md)。
  // **座標の原点は行を並べている器。** スクロール要素を原点にすると、
  // 上に余白を足しただけで掴む行と落ちる位置がずれる
  const rowsLayer = useRef<HTMLDivElement>(null);
  const drag = useRepoDrag(rows, viewport, rowsLayer);
  const draggingRepoId = drag?.repoId ?? null;

  // いま見ているリポジトリの見出しを上端に残す。仮想化した行に position: sticky は
  // 効かない (行が DOM から消える) ので、固定するぶんは別に描く
  const scrollTop = useScrollTop(viewport);
  const sticky = stickyHeaderAt(repoBlocks(rows), scrollTop, ROW_HEIGHT);
  const stickyRow = sticky === null ? undefined : rows[sticky.rowIndex];

  const renderRow = useCallback(
    (row: RowNode) => (
      <TreeRow
        row={row}
        selected={row.key === selectedKey}
        dragging={row.repoId === draggingRepoId}
        onSelect={select}
        onToggle={toggleExpanded}
        onActivate={onActivate}
        onContextMenu={onContextMenu}
      />
    ),
    [selectedKey, draggingRepoId, select, toggleExpanded, onActivate, onContextMenu],
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
    <div className={styles.tree}>
      <ScrollArea className={styles.scroll} onViewport={onViewport}>
        <div className={styles.layer} ref={rowsLayer}>
          <VirtualRows
            items={rows}
            rowHeight={ROW_HEIGHT}
            scrollElement={viewport}
            keyOf={keyOf}
            renderRow={renderRow}
            revealKey={selectedKey ?? undefined}
          />
          {drag !== null && <DropLine offset={drag.offset} />}
        </div>
      </ScrollArea>
      {sticky !== null && stickyRow !== undefined && (
        <StickyRepo offset={sticky.offset}>{renderRow(stickyRow)}</StickyRepo>
      )}
    </div>
  );
}

/**
 * ビューポートのスクロール量。
 *
 * 仮想リストと同じ要素を見る。**描くたびに読む** ので、`scroll` が来ない
 * 動き方 (ビューポートの差し替え、位置の復元) でも固定表示が置き去りにならない。
 */
function useScrollTop(viewport: HTMLElement | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (viewport === null) return () => undefined;
      viewport.addEventListener("scroll", onChange, { passive: true });
      return () => {
        viewport.removeEventListener("scroll", onChange);
      };
    },
    [viewport],
  );

  return useSyncExternalStore(subscribe, () => viewport?.scrollTop ?? 0);
}

/**
 * 上端に固定するリポジトリ見出し。
 *
 * **行を並べている器の外に描く。** 仮想化すると画面外の行は DOM から消えるので、
 * 見出しの行そのものは残せない (docs/adr/0004-virtual-scroll.md)。
 * 器の外に出すことで、ドラッグの購読 (`.layer`) からも外れる。固定した見出しからの
 * 並び替えは持たない (docs/adr/0019-reorder-without-dnd-kit.md)。
 */
function StickyRepo({
  offset,
  children,
}: {
  readonly offset: number;
  readonly children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 位置は実行時に決まる。JSX の `style` は使わない (docs/security.md)
  useCssVariable(ref, "--sticky-y", `${offset}px`);

  return (
    <div className={styles.sticky} ref={ref}>
      {children}
    </div>
  );
}

function keyOf(row: RowNode): string {
  return row.key;
}

/**
 * 挿入線。
 *
 * **リポジトリのブロック境界に描く。** 展開中のリポジトリの見出しの下に出すと、
 * 配下の行の後ろに着地して線と結果がずれる (docs/specs/ui.md)。
 */
function DropLine({ offset }: { readonly offset: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // 位置は実行時に決まる。JSX の `style` は使わない (docs/security.md)
  useCssVariable(ref, "--drop-y", `${offset}px`);

  return <div className={styles.dropLine} ref={ref} />;
}

/**
 * ツリーのペイン。幅は `UiState.pane_width`。
 *
 * **検索欄は最上部に固定する。** ツリーをスクロールしても残る
 * (docs/specs/ui.md の「画面の構成」)。
 */
export function TreePane({ children }: { readonly children: React.ReactNode }) {
  const paneWidth = useUiStore((state) => state.paneWidth);
  const paneRef = useRef<HTMLDivElement>(null);
  // 幅を CSS 変数で渡す。JSX の `style` は使わない (docs/security.md)
  useCssVariable(paneRef, "--pane-width", `${paneWidth}px`);

  return (
    // tabIndex は選択色をフォーカスで変えるため。キーボード操作は持たない
    // (docs/adr/0008-no-keyboard-shortcuts.md)
    <div className={styles.pane} ref={paneRef} tabIndex={0} data-tree-pane="">
      <SearchBar />
      {children}
    </div>
  );
}
