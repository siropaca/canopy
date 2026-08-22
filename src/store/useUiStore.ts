import { create, type StateCreator } from "zustand";

import type { UiState } from "@/ipc/generated/UiState";
import type { WindowState } from "@/ipc/generated/WindowState";
import type { RepoId } from "@/ipc/types";
import { close, open } from "@/shared/lib/treeKeys";

/*
 * UI の状態。永続化する項目は docs/specs/data-model.md の `UiState`。
 * 保存は store/persist.ts がまとめて行う。
 */

/** ツリーペインの幅の範囲 (docs/specs/ui.md) */
export const MIN_PANE_WIDTH = 240;
export const MAX_PANE_WIDTH = 760;

export interface UiStoreState {
  /** **開いている**鍵 */
  readonly expanded: ReadonlySet<string>;
  readonly selectedKey: string | null;
  readonly query: string;
  readonly paneWidth: number;
  readonly groupDirectories: boolean;
  readonly localOnly: boolean;
  readonly consoleOpen: boolean;
  /** 復元はフェーズ 4。ここでは保存のために持っているだけ */
  readonly windowState: WindowState | null;

  /** 保存してあった状態を読み込む */
  hydrate: (uiState: UiState) => void;
  /** 開いていれば閉じる (配下も閉じる)、閉じていれば開く */
  toggleExpanded: (key: string) => void;
  /** 開いている鍵を丸ごと置き換える (すべて展開・すべて折りたたむ) */
  setExpanded: (keys: Iterable<string>) => void;
  /** 鍵を足す。登録した直後の既定の展開に使う */
  openKeys: (keys: Iterable<string>) => void;
  select: (key: string | null) => void;
  setQuery: (query: string) => void;
  setPaneWidth: (width: number) => void;
  /** コンソールパネルの開閉。サイドバーのボタンとパネルの `✕` から */
  toggleConsole: () => void;
  /** コンソールを開く。トーストの `詳細を見る` から (トグルではない) */
  setConsoleOpen: (open: boolean) => void;
  toggleGroupDirectories: () => void;
  toggleLocalOnly: () => void;
}

const creator: StateCreator<UiStoreState> = (set) => ({
  expanded: new Set<string>(),
  selectedKey: null,
  query: "",
  paneWidth: 360,
  groupDirectories: true,
  localOnly: false,
  consoleOpen: false,
  windowState: null,

  hydrate: (uiState) =>
    set(() => ({
      expanded: new Set(uiState.expanded),
      paneWidth: clampPaneWidth(uiState.pane_width),
      groupDirectories: uiState.group_directories,
      localOnly: uiState.local_only,
      consoleOpen: uiState.console_open,
      windowState: uiState.window,
    })),

  toggleExpanded: (key) =>
    set((state) => ({
      expanded: state.expanded.has(key) ? close(state.expanded, key) : open(state.expanded, key),
    })),

  setExpanded: (keys) => set(() => ({ expanded: new Set(keys) })),

  openKeys: (keys) =>
    set((state) => {
      const next = new Set(state.expanded);
      for (const key of keys) next.add(key);
      return { expanded: next };
    }),

  select: (key) => set(() => ({ selectedKey: key })),

  setQuery: (query) => set(() => ({ query })),

  setPaneWidth: (width) => set(() => ({ paneWidth: clampPaneWidth(width) })),

  toggleConsole: () => set((state) => ({ consoleOpen: !state.consoleOpen })),

  setConsoleOpen: (open) => set(() => ({ consoleOpen: open })),

  toggleGroupDirectories: () => set((state) => ({ groupDirectories: !state.groupDirectories })),

  toggleLocalOnly: () => set((state) => ({ localOnly: !state.localOnly })),
});

export function clampPaneWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_PANE_WIDTH;
  return Math.round(Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, width)));
}

/**
 * 保存する形にする。
 *
 * `repo_order` はリポジトリのストアが持っているので引数で受ける。
 * 選択と検索語は保存しない (docs/specs/data-model.md の `UiState`)。
 */
export function toUiState(state: UiStoreState, order: readonly RepoId[]): UiState {
  return {
    repo_order: [...order],
    expanded: [...state.expanded].sort(),
    pane_width: state.paneWidth,
    console_open: state.consoleOpen,
    window: state.windowState,
    group_directories: state.groupDirectories,
    local_only: state.localOnly,
  };
}

export const useUiStore = create<UiStoreState>()(creator);

/** テスト用に独立したストアを作る */
export const createUiStore = () => create<UiStoreState>()(creator);
