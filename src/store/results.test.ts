import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { CommandStep } from "@/ipc/generated/CommandStep";

import {
  cancelBulkFetch,
  recordBulkResult,
  recordResult,
  retargetBulkFetch,
  startBulkFetch,
} from "./results";
import { bulkFetchRunning, useBulkFetchStore } from "./useBulkFetchStore";
import { useConsoleStore } from "./useConsoleStore";
import { useRepoStore } from "./useRepoStore";
import { useToastStore } from "./useToastStore";
import { useUiStore } from "./useUiStore";

/*
 * 結果の出し先を 1 本にする。
 *
 * コンソールとトーストの出し分けは `CommandResult.kind` で決める
 * (docs/adr/0018-command-result-steps.md)。**`steps` の長さで判定しない。**
 */

function step(overrides: Partial<CommandStep> = {}): CommandStep {
  return {
    dir: "/repos/acme-api",
    command: "git fetch --prune",
    code: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function ran(steps: CommandStep[], overrides: Partial<CommandResult> = {}): CommandResult {
  return { kind: "ran", ok: true, steps, message: null, ...overrides };
}

function toasts() {
  return useToastStore.getState().toasts;
}

function blocksOf(repoId: string) {
  return useConsoleStore.getState().blocks.get(repoId) ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
  useRepoStore.getState().registerAll([
    { id: "r1", name: "acme-api", path: "/repos/acme-api" },
    { id: "r2", name: "acme-web", path: "/repos/acme-web" },
  ]);
  useConsoleStore.setState({
    blocks: new Map(),
    activeTab: null,
    failed: new Set(),
    nextBlockId: 1,
  });
  useToastStore.getState().clear();
  useBulkFetchStore.getState().reset();
  useUiStore.setState({ consoleOpen: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("git を実行した結果", () => {
  it("段ごとのブロックをコンソールに積む", () => {
    recordResult("r1", ran([step({ command: "git switch topic" }), step({ command: "git pull" })]));

    expect(blocksOf("r1")).toHaveLength(2);
    expect(blocksOf("r1")[0]?.lines[0]?.text).toContain("[/repos/acme-api] git switch topic");
  });

  it("成功のトーストは実行したコマンドを出す", () => {
    recordResult("r1", ran([step({ command: "git fetch --prune" })]));

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      kind: "success",
      text: "git fetch --prune",
      repoName: "acme-api",
      command: true,
    });
  });

  it("2 段の操作はコマンドを並べて出す", () => {
    recordResult("r1", ran([step({ command: "git switch topic" }), step({ command: "git pull" })]));

    expect(toasts()[0]?.text).toBe("git switch topic && git pull");
  });

  it("成功しても伝えるべき文言があればそれを出す", () => {
    recordResult(
      "r1",
      ran([step({ command: "git switch topic" })], {
        message: "既存のローカルブランチに切り替えました",
      }),
    );

    expect(toasts()[0]).toMatchObject({
      kind: "success",
      text: "既存のローカルブランチに切り替えました",
      command: false,
    });
  });

  it("失敗のトーストは文言とコンソールへの導線を持つ", () => {
    recordResult(
      "r1",
      ran([step({ code: 1, stderr: "error: cannot pull" })], {
        ok: false,
        message: "プルに失敗しました (未コミットの変更あり)",
      }),
    );

    expect(toasts()[0]).toMatchObject({
      kind: "failure",
      text: "プルに失敗しました (未コミットの変更あり)",
      detailRepoId: "r1",
    });
  });

  it("失敗したタブに赤いドットを立てる", () => {
    recordResult("r1", ran([step({ code: 1 })], { ok: false, message: "失敗しました" }));

    expect(useConsoleStore.getState().failed.has("r1")).toBe(true);
  });

  it("見ているタブの失敗にはドットを立てない", () => {
    // 開いているコンソールに印を付けても、消すための操作が無い
    useUiStore.setState({ consoleOpen: true });
    useConsoleStore.setState({ activeTab: "r1" });

    recordResult("r1", ran([step({ code: 1 })], { ok: false, message: "失敗しました" }));

    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
  });
});

describe("git を実行していない結果", () => {
  it("コピーの成功はトーストだけで、コンソールには出さない", () => {
    recordResult("r1", {
      kind: "direct",
      ok: true,
      steps: [],
      message: "コピーしました: topic",
    });

    expect(blocksOf("r1")).toHaveLength(0);
    expect(toasts()[0]).toMatchObject({ kind: "success", text: "コピーしました: topic" });
  });

  it("コンソールに出す段が無い失敗は 詳細を見る を出さない", () => {
    recordResult("r1", {
      kind: "direct",
      ok: false,
      steps: [],
      message: "クリップボードに書けませんでした",
    });

    expect(toasts()[0]).toMatchObject({ kind: "failure" });
    expect(toasts()[0]?.detailRepoId).toBeUndefined();
  });

  it("省略は失敗ではないので赤くしない", () => {
    // `ok` は false だが失敗ではない (docs/adr/0018-command-result-steps.md)
    recordResult("r1", {
      kind: "skipped",
      ok: false,
      steps: [],
      message: "同じ操作を実行中です",
    });

    expect(toasts()[0]).toMatchObject({ kind: "success", text: "同じ操作を実行中です" });
    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
  });
});

describe("一括フェッチ", () => {
  it("リポジトリごとにはトーストを出さない", () => {
    startBulkFetch(["r1", "r2"]);

    recordBulkResult("r1", ran([step()]));

    expect(toasts()).toHaveLength(0);
    expect(blocksOf("r1")).toHaveLength(1);
  });

  it("全件そろったら 1 件にまとめて出す", () => {
    startBulkFetch(["r1", "r2"]);

    recordBulkResult("r1", ran([step()]));
    recordBulkResult("r2", ran([step({ code: 1 })], { ok: false, message: "失敗しました" }));

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      kind: "success",
      text: "2 リポジトリをフェッチしました (失敗 1)",
    });
  });

  it("集約したあとは次の一括フェッチを待てる", () => {
    startBulkFetch(["r1"]);
    recordBulkResult("r1", ran([step()]));

    startBulkFetch(["r1"]);
    recordBulkResult("r1", ran([step()]));

    expect(toasts()).toHaveLength(2);
  });

  it("対象でないリポジトリの結果は個別に出す", () => {
    startBulkFetch(["r1"]);

    recordBulkResult("r2", ran([step({ command: "git fetch --prune" })]));

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.text).toBe("git fetch --prune");
  });

  /** 結果が先に全部届いてから `fetch_all` が解決する順序があり得る */
  it("全件そろったあとに retarget が来ても、実行中に戻さない", () => {
    startBulkFetch(["r1"]);
    recordBulkResult("r1", ran([step()]));

    retargetBulkFetch(["r1"]);

    expect(bulkFetchRunning(useBulkFetchStore.getState())).toBe(false);
    // 集約のトーストが 2 度出ることもない
    expect(toasts()).toHaveLength(1);
  });

  it("投げられなかったら集計を畳む", () => {
    startBulkFetch(["r1", "r2"]);

    cancelBulkFetch();

    expect(bulkFetchRunning(useBulkFetchStore.getState())).toBe(false);
    expect(toasts()).toHaveLength(0);
  });

  it("タブがまだ 1 つも無いときは、コンソールが開いていてもドットを立てない", () => {
    // その出力が最初のタブになるので、開いた時点で見えている
    useUiStore.setState({ consoleOpen: true });

    recordResult("r1", ran([step({ code: 1 })], { ok: false, message: "失敗しました" }));

    expect(useConsoleStore.getState().failed.has("r1")).toBe(false);
  });

  it("対象が減って全件そろったらその時点でまとめて出す", () => {
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step()]));

    retargetBulkFetch(["r1"]);

    expect(toasts()[0]?.text).toBe("1 リポジトリをフェッチしました");
  });
});
