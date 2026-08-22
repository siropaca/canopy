import { beforeEach, describe, expect, it } from "vitest";

import {
  bulkFetchRunning,
  bulkFetchSettled,
  bulkFetchSummary,
  useBulkFetchStore,
} from "./useBulkFetchStore";

/*
 * 一括フェッチの集計。
 *
 * リポジトリごとにトーストを出さず 1 件に集約する (docs/specs/ui.md の「トースト」)。
 * 実行中はボタンを無効にするので、**残り件数の正はここ 1 本**。
 */

function state() {
  return useBulkFetchStore.getState();
}

beforeEach(() => {
  state().reset();
});

describe("一括フェッチの集計", () => {
  it("結果が全部届くまで実行中のまま", () => {
    state().start(["r1", "r2"]);
    expect(bulkFetchRunning(state())).toBe(true);

    state().note("r1", true);
    expect(bulkFetchRunning(state())).toBe(true);

    state().note("r2", true);
    expect(bulkFetchRunning(state())).toBe(false);
    expect(bulkFetchSettled(state())).toBe(true);
  });

  it("走っていなければ実行中ではない", () => {
    expect(bulkFetchRunning(state())).toBe(false);
    expect(bulkFetchSettled(state())).toBe(false);
  });

  it("対象でない結果は数えない", () => {
    state().start(["r1"]);

    expect(state().note("r2", false)).toBe(false);
    expect(bulkFetchRunning(state())).toBe(true);
  });

  it("同じリポジトリの結果が二度届いても 1 件として数える", () => {
    state().start(["r1", "r2"]);

    expect(state().note("r1", true)).toBe(true);
    expect(state().note("r1", true)).toBe(false);

    expect(bulkFetchRunning(state())).toBe(true);
  });

  it("対象から外れたリポジトリを待たない", () => {
    // 投げる前は登録済みの全件を対象にする。Rust が返した一覧で合わせる
    state().start(["r1", "r2"]);
    state().note("r1", true);

    state().retarget(["r1"]);

    expect(bulkFetchRunning(state())).toBe(false);
    expect(bulkFetchSummary(state())).toBe("1 リポジトリをフェッチしました");
  });

  it("知らなかったリポジトリが返ってきたら待つ", () => {
    state().start(["r1"]);
    state().note("r1", true);

    state().retarget(["r1", "r2"]);

    expect(bulkFetchRunning(state())).toBe(true);
  });

  it("対象から外れたリポジトリの失敗は集計から落とす", () => {
    state().start(["r1", "r2"]);
    state().note("r1", false);
    state().note("r2", true);

    state().retarget(["r2"]);

    expect(bulkFetchSummary(state())).toBe("1 リポジトリをフェッチしました");
  });

  it("失敗があれば件数を添える", () => {
    state().start(["r1", "r2", "r3"]);
    state().note("r1", true);
    state().note("r2", false);
    state().note("r3", false);

    expect(bulkFetchSummary(state())).toBe("3 リポジトリをフェッチしました (失敗 2)");
  });

  /**
   * **集約が済んだあとに `retarget` が来ても、実行中に戻さない。**
   *
   * 投げる前に集計を始めるので、結果が全部届いてから `fetch_all` の戻り値が
   * 解決する順序があり得る。戻すとボタンが再起動まで無効のままになる。
   */
  it("集約が済んだあとの retarget は実行中に戻さない", () => {
    state().start(["r1"]);
    state().note("r1", true);
    state().reset();

    state().retarget(["r1"]);

    expect(bulkFetchRunning(state())).toBe(false);
    expect(bulkFetchSettled(state())).toBe(false);
  });

  it("次の一括フェッチは前回の結果を持ち越さない", () => {
    state().start(["r1", "r2"]);
    state().note("r1", true);

    state().start(["r1", "r2"]);

    expect(bulkFetchRunning(state())).toBe(true);
    expect(state().note("r1", true)).toBe(true);
  });

  it("止めれば実行中ではなくなる", () => {
    state().start(["r1", "r2"]);

    state().reset();

    expect(bulkFetchRunning(state())).toBe(false);
  });
});
