import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpOutcome } from "@/ipc/generated/OpOutcome";
import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import {
  makeBranch,
  makeCommandResult,
  makeOutcome,
  makePushPreview,
  makeRef,
  makeRepo,
  makeSnapshot,
} from "@/test/factories";

vi.mock("@/ipc/ops");
vi.mock("@/ipc/events");

import { onRepoSnapshotUpdated } from "@/ipc/events";
import * as ipc from "@/ipc/ops";

import { applyRepoUpdate, listenForRepoUpdates, resetListening } from "./events";

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
} from "./opsActions";
import { orderedRepos, useRepoStore } from "./useRepoStore";

/** 実行中は本数が正で、`orderedRepos` が写す */
function runningOf(id: string): boolean | undefined {
  return orderedRepos(useRepoStore.getState()).find((repo) => repo.id === id)?.running;
}

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

function outcome(overrides: Partial<OpOutcome> = {}): OpOutcome {
  return makeOutcome({ snapshot: makeSnapshot({ id: "r1", revision: 5 }), ...overrides });
}

/** 種類ごとに 1 行ずつ揃った行 */
function rows(): RowNode[] {
  const repo = makeRepo("r1", {
    local: [makeBranch("main", { is_current: true }), makeBranch("feature/a")],
    remote: [makeRef("origin/main")],
    tags: [makeRef("v1.0.0")],
  });
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local", "remote", "tag"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function pick(predicate: (row: RowNode) => boolean): RowNode {
  const row = rows().find(predicate);
  if (row === undefined) throw new Error("行が無い");
  return row;
}

/** ラベルで探すブランチ行 */
function branchRow(label: string): RowNode {
  return pick((row) => row.kind === "branch" && row.label === label);
}

describe("操作の実行", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetListening();
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: false,
      loadError: null,
      lastResult: new Map(),
      running: new Map(),
    });
    useRepoStore.getState().registerAll([registration("r1", "acme-api")]);
  });

  it("実行中は印が付き、終わると解ける", async () => {
    let seenWhileRunning = false;
    vi.mocked(ipc.fetchRepo).mockImplementation(() => {
      seenWhileRunning = runningOf("r1") ?? false;
      return Promise.resolve(outcome());
    });

    await fetchRepository("r1");

    expect(seenWhileRunning).toBe(true);
    expect(runningOf("r1")).toBe(false);
  });

  it("成功したらスナップショットと結果が入る", async () => {
    vi.mocked(ipc.fetchRepo).mockResolvedValue(
      outcome({ result: makeCommandResult({ message: null }) }),
    );

    await fetchRepository("r1");

    const repo = useRepoStore.getState().byId.get("r1");
    expect(repo?.status).toBe("ready");
    expect(repo?.snapshot?.revision).toBe(5);
    expect(useRepoStore.getState().lastResult.get("r1")?.ok).toBe(true);
  });

  it("git が失敗しても結果として反映する。**出力を捨てない**", async () => {
    vi.mocked(ipc.fetchRepo).mockResolvedValue(
      outcome({
        result: makeCommandResult({ ok: false, message: "認証に失敗しました" }),
      }),
    );

    await fetchRepository("r1");

    const result = useRepoStore.getState().lastResult.get("r1");
    expect(result?.ok).toBe(false);
    expect(result?.message).toBe("認証に失敗しました");
    expect(result?.steps).toHaveLength(1);
    // 成否に関係なく取り直した状態が入る
    expect(useRepoStore.getState().byId.get("r1")?.snapshot?.revision).toBe(5);
  });

  it("アプリ側の異常も文言にして残し、実行中を解く", async () => {
    vi.mocked(ipc.fetchRepo).mockRejectedValue("ディレクトリが見つかりません");

    await fetchRepository("r1");

    expect(useRepoStore.getState().lastResult.get("r1")).toEqual({
      kind: "direct",
      ok: false,
      steps: [],
      message: "ディレクトリが見つかりません",
    });
    expect(runningOf("r1")).toBe(false);
  });

  it("現在のブランチのプルは `pull --rebase`、他のブランチは早送り", async () => {
    vi.mocked(ipc.pullCurrent).mockResolvedValue(outcome());
    vi.mocked(ipc.fastForwardBranch).mockResolvedValue(outcome());

    await pullRow(pick((row) => row.kind === "repo"));
    await pullRow(branchRow("main"));
    await pullRow(branchRow("a"));

    expect(ipc.pullCurrent).toHaveBeenCalledTimes(2);
    expect(ipc.fastForwardBranch).toHaveBeenCalledExactlyOnceWith("r1", "feature/a");
  });

  it("リモートは完全な名前で渡す (分岐は Rust 側)", async () => {
    vi.mocked(ipc.checkoutBranch).mockResolvedValue(outcome());

    await checkoutRow(pick((row) => row.kind === "remote"));

    expect(ipc.checkoutBranch).toHaveBeenCalledExactlyOnceWith("r1", "origin/main");
  });

  it("タグは専用のコマンドで detached にする", async () => {
    vi.mocked(ipc.checkoutTag).mockResolvedValue(outcome());

    await checkoutRow(pick((row) => row.kind === "tag"));

    expect(ipc.checkoutTag).toHaveBeenCalledExactlyOnceWith("r1", "v1.0.0");
    expect(ipc.checkoutBranch).not.toHaveBeenCalled();
  });

  it("タグはチェックアウトとプルの対象にしない", async () => {
    const result = await checkoutAndPullRow(pick((row) => row.kind === "tag"));

    expect(result.ok).toBe(false);
    expect(ipc.checkoutAndPull).not.toHaveBeenCalled();
  });

  it("括りとディレクトリは操作の対象にしない", async () => {
    const section = await pullRow(pick((row) => row.kind === "section"));
    const directory = await checkoutRow(pick((row) => row.kind === "directory"));

    expect(section.ok).toBe(false);
    expect(directory.ok).toBe(false);
    expect(ipc.pullCurrent).not.toHaveBeenCalled();
    expect(ipc.checkoutBranch).not.toHaveBeenCalled();
  });

  it("一括フェッチは返ってきた id を全部実行中にする", async () => {
    useRepoStore.getState().registerAll([registration("r1", "a"), registration("r2", "b")]);
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(() => undefined);
    await listenForRepoUpdates();
    vi.mocked(ipc.fetchAll).mockResolvedValue(["r1", "r2"]);

    const ids = await fetchAllRepositories();

    expect(ids).toEqual(["r1", "r2"]);
    expect(runningOf("r1")).toBe(true);
    expect(runningOf("r2")).toBe(true);
  });

  /**
   * イベントが来ない状態で実行中の印を付けると、そのリポジトリの操作系が
   * 永久に無効になる。1 件ずつ投げる形に落として、自分で解く
   */
  it("購読が張れていなければ 1 件ずつ投げる", async () => {
    useRepoStore.getState().registerAll([registration("r1", "a"), registration("r2", "b")]);
    vi.mocked(ipc.fetchRepo).mockResolvedValue(outcome());

    const ids = await fetchAllRepositories();

    expect(ids).toEqual(["r1", "r2"]);
    expect(ipc.fetchAll).not.toHaveBeenCalled();
    expect(ipc.fetchRepo).toHaveBeenCalledTimes(2);
    expect(runningOf("r1")).toBe(false);
    expect(runningOf("r2")).toBe(false);
  });

  /**
   * 並列に投げるとネットワークの枠 4 本を一括フェッチが占めて、
   * 対話操作のために空けてある枠が無くなる
   */
  it("落ちた先では 1 本ずつ順に投げる", async () => {
    useRepoStore
      .getState()
      .registerAll([registration("r1", "a"), registration("r2", "b"), registration("r3", "c")]);
    let inFlight = 0;
    let peak = 0;
    vi.mocked(ipc.fetchRepo).mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return outcome();
    });

    await fetchAllRepositories();

    expect(ipc.fetchRepo).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  /**
   * ディレクトリが消えているリポジトリは git を起こす前に失敗するので、
   * イベントが invoke の応答より先に届く。あとで印を付けると永久に残る
   */
  it("イベントが先に届いても実行中の印が残らない", async () => {
    useRepoStore.getState().registerAll([registration("r1", "a")]);
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(() => undefined);
    await listenForRepoUpdates();
    vi.mocked(ipc.fetchAll).mockImplementation(() => {
      // invoke の応答より先にイベントが届いた
      applyRepoUpdate({ repo_id: "r1", outcome: null, error: "ディレクトリが見つかりません" });
      return Promise.resolve(["r1"]);
    });

    await fetchAllRepositories();

    expect(runningOf("r1")).toBe(false);
  });

  it("対象から外れた id の印は自分で解く", async () => {
    useRepoStore.getState().registerAll([registration("r1", "a"), registration("r2", "b")]);
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(() => undefined);
    await listenForRepoUpdates();
    // r2 は設定から消えていて、フェッチの対象に入らなかった
    vi.mocked(ipc.fetchAll).mockResolvedValue(["r1"]);

    await fetchAllRepositories();

    expect(runningOf("r1")).toBe(true);
    expect(runningOf("r2")).toBe(false);
  });

  it("一括フェッチの一覧が引けなければ理由を出す", async () => {
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(() => undefined);
    await listenForRepoUpdates();
    vi.mocked(ipc.fetchAll).mockRejectedValue(new Error("設定を読めませんでした"));

    const ids = await fetchAllRepositories();

    expect(ids).toEqual([]);
    expect(useRepoStore.getState().loadError).toBe("設定を読めませんでした");
    // 投げる前に付けた印を戻す
    expect(runningOf("r1")).toBe(false);
  });

  it("クリップボードの失敗を握りつぶさない", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("コピーできません")) },
    });

    await copyToClipboard("r1", "feature/a");

    expect(useRepoStore.getState().lastResult.get("r1")).toEqual({
      kind: "direct",
      ok: false,
      steps: [],
      message: "コピーできません",
    });
    vi.unstubAllGlobals();
  });

  it("コピーが成功したことも見せる", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });

    await copyToClipboard("r1", "feature/a");

    expect(useRepoStore.getState().lastResult.get("r1")?.message).toBe("コピーしました: feature/a");
    vi.unstubAllGlobals();
  });

  it("チェックアウトとプルは専用のコマンドを呼ぶ (プルを落とさない)", async () => {
    vi.mocked(ipc.checkoutAndPull).mockResolvedValue(outcome());

    await checkoutAndPullRow(branchRow("a"));

    expect(ipc.checkoutAndPull).toHaveBeenCalledExactlyOnceWith("r1", "feature/a");
    expect(ipc.checkoutBranch).not.toHaveBeenCalled();
  });

  /** 旧名と新名を入れ替えると、別のブランチの名前を変えてしまう */
  it("名前の変更は旧名 → 新名の順で渡す", async () => {
    vi.mocked(ipc.renameBranch).mockResolvedValue(outcome());

    await renameBranch("r1", "old", "new");

    expect(ipc.renameBranch).toHaveBeenCalledExactlyOnceWith("r1", "old", "new");
  });

  /** lease を捨てると、強制プッシュのつもりが通常プッシュになる */
  it("プッシュは sha をそのまま渡す", async () => {
    vi.mocked(ipc.pushBranch).mockResolvedValue(outcome());

    await pushBranch("r1", "main", "abc1234");
    await pushBranch("r1", "main");

    expect(ipc.pushBranch).toHaveBeenNthCalledWith(1, "r1", "main", "abc1234");
    expect(ipc.pushBranch).toHaveBeenNthCalledWith(2, "r1", "main", null);
  });

  it("直前のブランチに戻る", async () => {
    vi.mocked(ipc.checkoutPrevious).mockResolvedValue(outcome());

    await checkoutPreviousBranch("r1");

    expect(ipc.checkoutPrevious).toHaveBeenCalledExactlyOnceWith("r1");
  });

  it("プッシュダイアログの中身を読む", async () => {
    vi.mocked(ipc.getPushPreview).mockResolvedValue(makePushPreview({ branch: "main" }));

    const preview = await loadPushPreview("r1", "main");

    expect(ipc.getPushPreview).toHaveBeenCalledExactlyOnceWith("r1", "main");
    expect(preview?.branch).toBe("main");
  });

  it("プッシュダイアログの中身が読めなければ理由を残して null を返す", async () => {
    vi.mocked(ipc.getPushPreview).mockRejectedValue("知らないリポジトリの id です (r404)");

    const preview = await loadPushPreview("r1", "main");

    expect(preview).toBeNull();
    expect(useRepoStore.getState().lastResult.get("r1")?.ok).toBe(false);
  });

  /** 文言は Rust 側が持つ。フロントで作り直さない */
  it("Finder とターミナルは Rust が返した結果をそのまま覚える", async () => {
    vi.mocked(ipc.revealInFinder).mockResolvedValue(
      makeCommandResult({ kind: "direct", steps: [], message: "Finder で表示しました" }),
    );
    vi.mocked(ipc.openInTerminal).mockResolvedValue(
      makeCommandResult({ kind: "direct", ok: false, steps: [], message: "open が失敗しました" }),
    );

    await revealRepository("r1");
    expect(useRepoStore.getState().lastResult.get("r1")?.message).toBe("Finder で表示しました");

    await openRepositoryInTerminal("r1");
    const result = useRepoStore.getState().lastResult.get("r1");
    expect(result?.ok).toBe(false);
    expect(result?.message).toBe("open が失敗しました");
  });

  /**
   * **取り直しに失敗しても実行した git の出力は残す。**
   * `Err` にすると stdout / stderr が消える (docs/adr/0009-concurrency-and-refresh.md)
   */
  it("状態を読み直せなくても結果は残り、見出しに理由が出る", async () => {
    vi.mocked(ipc.fetchRepo).mockResolvedValue(
      outcome({
        result: makeCommandResult({ message: "フェッチしました" }),
        snapshot: null,
        snapshot_error: "ディレクトリが見つかりません",
      }),
    );

    await fetchRepository("r1");

    const repo = useRepoStore.getState().byId.get("r1");
    expect(repo?.status).toBe("error");
    expect(repo?.error).toBe("ディレクトリが見つかりません");
    expect(useRepoStore.getState().lastResult.get("r1")?.message).toBe("フェッチしました");
    expect(useRepoStore.getState().lastResult.get("r1")?.steps).toHaveLength(1);
    expect(runningOf("r1")).toBe(false);
  });
});
