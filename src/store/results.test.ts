import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { CommandStep } from "@/ipc/generated/CommandStep";

import {
  BULK_FETCH_IDLE_LIMIT_MS,
  cancelBulkFetch,
  recordBulkResult,
  recordResult,
  retargetBulkFetch,
  startBulkFetch,
} from "./results";
import { applyRepoUpdate } from "./events";
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
  useRepoStore.setState({ running: new Map() });
  useUiStore.setState({ consoleOpen: false, windowVisible: true });
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

function runningOf(repoId: string): boolean {
  return (useRepoStore.getState().running.get(repoId) ?? 0) > 0;
}

describe("結果が届かない一括フェッチ", () => {
  /**
   * イベントは全リポジトリぶん飛ぶ前提だが、購読が切れるとその前提が崩れる。
   * 1 件でも届かないと「実行中」が解けず、フェッチのボタンが再起動まで無効になる
   * (docs/plans/phase-4-polish.md からの持ち越し)
   */
  /**
   * **短くすると誤検知する。** フェッチは同じリポジトリの書き込みロックを待つので、
   * プル (締め切り 600 秒) の後ろに付くとその間ずっと無音になる。
   * `src-tauri/src/op_kind.rs` の 600 秒 + 30 秒に合わせてある
   */
  it("猶予は 630 秒 (プルの締め切り 600 秒 + フェッチの 30 秒)", () => {
    expect(BULK_FETCH_IDLE_LIMIT_MS).toBe(630_000);
  });

  it("届かないまま猶予を過ぎたら、実行中の印を外して 1 件のトーストを出す", () => {
    useRepoStore.getState().beginRun("r1");
    useRepoStore.getState().beginRun("r2");
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step()]));

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);

    expect(runningOf("r2")).toBe(false);
    expect(bulkFetchRunning(useBulkFetchStore.getState())).toBe(false);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.kind).toBe("failure");
    expect(toasts()[0]?.text).toBe("2 リポジトリをフェッチしました (結果が届かない 1)");
  });

  /** **投げた時点から見張る。** 1 件目が届いてから始めると、購読が最初から
   * 切れているときに永久に待つことになる */
  it("1 件も届かないまま猶予を過ぎても畳む", () => {
    useRepoStore.getState().beginRun("r1");
    startBulkFetch(["r1"]);

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);

    expect(runningOf("r1")).toBe(false);
    expect(toasts()[0]?.text).toBe("1 リポジトリをフェッチしました (結果が届かない 1)");
  });

  it("届いたリポジトリの実行中は触らない", () => {
    // 届いた分の印は `applyRepoUpdate` が外す。ここで二重に外さない
    useRepoStore.getState().beginRun("r1");
    useRepoStore.getState().beginRun("r2");
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step()]));

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);

    expect(runningOf("r1")).toBe(true);
  });

  it("失敗と届かない分は両方まとめて出す", () => {
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step({ code: 1 })], { ok: false }));

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);

    expect(toasts()[0]?.text).toBe("2 リポジトリをフェッチしました (失敗 1, 結果が届かない 1)");
  });

  /** **1 件届くたびに数え直す。** リポジトリの数だけ時間がかかる操作なので */
  it("結果が届くたびに猶予を数え直す", () => {
    startBulkFetch(["r1", "r2"]);

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS - 1);
    recordBulkResult("r1", ran([step()]));
    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS - 1);

    // 数え直していなければ、ここで畳まれている
    expect(bulkFetchRunning(useBulkFetchStore.getState())).toBe(true);
    expect(toasts()).toHaveLength(0);
  });

  it("全件そろったら見張りは消える", () => {
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step()]));
    recordBulkResult("r2", ran([step()]));
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS * 2);

    // 集約した 1 件だけ。畳んだトーストが後から増えない
    expect(toasts().filter((toast) => toast.kind === "failure")).toHaveLength(0);
  });

  /**
   * **待っていないのにタイマーを残さない。** 常駐して使うので、
   * 一括フェッチのたびに空振りの見張りが積まれると 60 秒ごとに起き続ける
   */
  it("投げられなかったら見張りのタイマーごと消える", () => {
    startBulkFetch(["r1", "r2"]);

    cancelBulkFetch();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS * 2);
    expect(toasts()).toHaveLength(0);
  });

  it("全件そろったら見張りのタイマーごと消える", () => {
    startBulkFetch(["r1", "r2"]);
    recordBulkResult("r1", ran([step()]));
    recordBulkResult("r2", ran([step()]));
    // 集約したトーストのタイマーは別枠なので落としてから数える
    useToastStore.getState().clear();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("畳んだあとに遅れて届いた結果", () => {
  /**
   * 畳んだ時点で実行中を 1 本外している。もう一度外すと、その時点で
   * **別の操作が握っている 1 本**を消す (docs/specs/ui.md の「実行中の扱い」)
   */
  it("実行中の印を二重に外さない", () => {
    useRepoStore.getState().beginRun("r1");
    startBulkFetch(["r1"]);
    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);
    expect(runningOf("r1")).toBe(false);
    // 畳んだあとに別の操作が始まる
    useRepoStore.getState().beginRun("r1");

    // 遅れて一括フェッチの結果が届く
    applyRepoUpdate({
      repo_id: "r1",
      outcome: { snapshot: null, snapshot_error: null, result: ran([step()]) },
      error: null,
    });

    expect(runningOf("r1")).toBe(true);
  });

  /**
   * 11 件遅れて届くと上限 6 を超えて、直前に出した集約のトーストごと押し出される
   * (docs/specs/ui.md の「トースト」)
   */
  it("リポジトリごとのトーストを出さない", () => {
    startBulkFetch(["r1", "r2"]);
    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);
    useToastStore.getState().clear();

    recordBulkResult("r1", ran([step()]));
    recordBulkResult("r2", ran([step()]));

    expect(toasts()).toHaveLength(0);
    // コンソールには残る
    expect(blocksOf("r1")).toHaveLength(1);
  });

  /**
   * **覚えを次の一括フェッチに持ち越さない。**
   * 持ち越すと、次に届いた結果で実行中が外れず、そのリポジトリの操作系が
   * 再起動まで無効のままになる
   */
  it("次の一括フェッチの結果では実行中が外れる", () => {
    // 1 回目: 届かないまま畳む
    useRepoStore.getState().beginRun("r1");
    startBulkFetch(["r1"]);
    vi.advanceTimersByTime(BULK_FETCH_IDLE_LIMIT_MS);
    useToastStore.getState().clear();

    // 2 回目: 今度は結果が届く
    useRepoStore.getState().beginRun("r1");
    startBulkFetch(["r1"]);
    applyRepoUpdate({
      repo_id: "r1",
      outcome: { snapshot: null, snapshot_error: null, result: ran([step()]) },
      error: null,
    });

    expect(runningOf("r1")).toBe(false);
    expect(toasts()[0]?.text).toBe("1 リポジトリをフェッチしました");
  });
});

describe("リストから消したリポジトリの結果", () => {
  /**
   * 一括フェッチの最中に消すと、あとから届いた結果で名前の引けないタブが
   * 復活する (docs/specs/ui.md の「コンソール」)
   */
  it("コンソールのタブを作り直さない", () => {
    startBulkFetch(["r1"]);
    useRepoStore.getState().remove("r1");

    recordBulkResult("r1", ran([step()]));

    expect(blocksOf("r1")).toHaveLength(0);
  });
});
