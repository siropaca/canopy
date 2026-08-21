import { beforeEach, describe, expect, it } from "vitest";

import type { UiState } from "@/ipc/generated/UiState";

import {
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  clampPaneWidth,
  createUiStore,
  toUiState,
  type UiStoreState,
} from "./useUiStore";

const SAVED: UiState = {
  repo_order: ["r2", "r1"],
  expanded: ["r1|repo|", "r1|local|"],
  pane_width: 420,
  console_open: true,
  window: null,
  group_directories: false,
  local_only: true,
};

describe("UI のストア", () => {
  let store: ReturnType<typeof createUiStore>;
  const state = (): UiStoreState => store.getState();

  beforeEach(() => {
    store = createUiStore();
  });

  it("既定はグループ化オン、ローカルのみオフ、幅 360 (docs/specs/ui.md)", () => {
    expect(state().groupDirectories).toBe(true);
    expect(state().localOnly).toBe(false);
    expect(state().paneWidth).toBe(360);
    expect(state().expanded.size).toBe(0);
  });

  it("保存してあった状態を読み込む", () => {
    state().hydrate(SAVED);

    expect([...state().expanded].sort()).toEqual(["r1|local|", "r1|repo|"]);
    expect(state().paneWidth).toBe(420);
    expect(state().groupDirectories).toBe(false);
    expect(state().localOnly).toBe(true);
    expect(state().consoleOpen).toBe(true);
  });

  it("開閉を切り替える。閉じたら配下も閉じる", () => {
    state().setExpanded(["r1|repo|", "r1|local|", "r1|local|feature"]);

    state().toggleExpanded("r1|local|");

    expect([...state().expanded]).toEqual(["r1|repo|"]);
  });

  it("閉じている鍵を開く", () => {
    state().setExpanded(["r1|repo|"]);

    state().toggleExpanded("r1|local|");

    expect([...state().expanded].sort()).toEqual(["r1|local|", "r1|repo|"]);
  });

  it("鍵を足すときは既にある鍵を消さない", () => {
    state().setExpanded(["r1|repo|"]);

    state().openKeys(["r2|repo|", "r2|local|"]);

    expect([...state().expanded].sort()).toEqual(["r1|repo|", "r2|local|", "r2|repo|"]);
  });

  it("すべて折りたたむは鍵を空にする", () => {
    state().setExpanded(["r1|repo|", "r1|local|"]);

    state().setExpanded([]);

    expect(state().expanded.size).toBe(0);
  });

  it("ペインの幅を範囲内に丸める", () => {
    state().setPaneWidth(100);
    expect(state().paneWidth).toBe(MIN_PANE_WIDTH);

    state().setPaneWidth(2000);
    expect(state().paneWidth).toBe(MAX_PANE_WIDTH);

    state().setPaneWidth(400.6);
    expect(state().paneWidth).toBe(401);
  });

  it("読み込んだ幅も範囲内に丸める", () => {
    state().hydrate({ ...SAVED, pane_width: 9999 });

    expect(state().paneWidth).toBe(MAX_PANE_WIDTH);
  });

  it("数値でない幅を弾く", () => {
    expect(clampPaneWidth(Number.NaN)).toBe(MIN_PANE_WIDTH);
  });
});

describe("toUiState", () => {
  it("保存する形にする。選択と検索語は入れない", () => {
    const store = createUiStore();
    store.getState().hydrate(SAVED);
    store.getState().select("r1|local|leaf|main");
    store.getState().setQuery("rec");

    const saved = toUiState(store.getState(), ["r1", "r2"]);

    expect(saved).toEqual({
      repo_order: ["r1", "r2"],
      expanded: ["r1|local|", "r1|repo|"],
      pane_width: 420,
      console_open: true,
      window: null,
      group_directories: false,
      local_only: true,
    });
  });

  it("鍵の並びを揃える。順番だけ違う保存を作らない", () => {
    const store = createUiStore();
    store.getState().setExpanded(["r2|repo|", "r1|repo|"]);

    expect(toUiState(store.getState(), []).expanded).toEqual(["r1|repo|", "r2|repo|"]);
  });
});
