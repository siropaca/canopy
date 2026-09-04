import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeOutcome, makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/events");
vi.mock("@/ipc/repos");

import { onRepoSnapshotUpdated, onReposChanged } from "@/ipc/events";
import * as repos from "@/ipc/repos";

import { resetRequests } from "./bootstrap";
import {
  applyRepoUpdate,
  isListeningForRepoUpdates,
  listenForRepoChanges,
  listenForRepoUpdates,
  resetListening,
} from "./events";
import { useBulkFetchStore } from "./useBulkFetchStore";
import { useConsoleStore } from "./useConsoleStore";
import { orderedRepos, useRepoStore } from "./useRepoStore";
import { useToastStore } from "./useToastStore";
import { useUiStore } from "./useUiStore";

function runningOf(id: string): boolean | undefined {
  return orderedRepos(useRepoStore.getState()).find((repo) => repo.id === id)?.running;
}

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

describe("一括フェッチのイベント", () => {
  beforeEach(() => {
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: false,
      loadError: null,
      running: new Map(),
    });
    useRepoStore.getState().registerAll([registration("r1", "a")]);
    useRepoStore.getState().beginRun("r1");
    useConsoleStore.setState({
      blocks: new Map(),
      activeTab: null,
      failed: new Set(),
      nextBlockId: 1,
    });
    useToastStore.getState().clear();
    useBulkFetchStore.getState().reset();
  });

  it("届いた分から差し替えて、実行中を解く", () => {
    applyRepoUpdate({
      repo_id: "r1",
      outcome: makeOutcome({ snapshot: makeSnapshot({ id: "r1", revision: 3 }) }),
      error: null,
    });

    const repo = useRepoStore.getState().byId.get("r1");
    expect(repo?.snapshot?.revision).toBe(3);
    expect(runningOf("r1")).toBe(false);
    expect(useConsoleStore.getState().blocks.get("r1")).toHaveLength(1);
  });

  /** invoke の解決順は発行順と一致しない (docs/adr/0009-concurrency-and-refresh.md) */
  it("古い世代は捨てる", () => {
    applyRepoUpdate({
      repo_id: "r1",
      outcome: makeOutcome({ snapshot: makeSnapshot({ id: "r1", revision: 7 }) }),
      error: null,
    });
    applyRepoUpdate({
      repo_id: "r1",
      outcome: makeOutcome({ snapshot: makeSnapshot({ id: "r1", revision: 4 }) }),
      error: null,
    });

    expect(useRepoStore.getState().byId.get("r1")?.snapshot?.revision).toBe(7);
  });

  it("状態が読めなかったリポジトリも行を消さず、理由を出す", () => {
    applyRepoUpdate({
      repo_id: "r1",
      outcome: null,
      error: "ディレクトリが見つかりません",
    });

    const repo = useRepoStore.getState().byId.get("r1");
    expect(repo?.status).toBe("error");
    expect(repo?.error).toBe("ディレクトリが見つかりません");
    expect(runningOf("r1")).toBe(false);
    // git を実行していないので段は無い。理由はトーストに出す
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      kind: "failure",
      text: "ディレクトリが見つかりません",
    });
  });

  /** 実行中が解けないと、そのリポジトリの操作系が永久に無効になる */
  it("消えたリポジトリのイベントでも落ちない", () => {
    useRepoStore.getState().remove("r1");

    applyRepoUpdate({
      repo_id: "r1",
      outcome: makeOutcome({ snapshot: makeSnapshot({ id: "r1" }) }),
      error: null,
    });

    expect(useRepoStore.getState().byId.has("r1")).toBe(false);
  });
});

describe("購読の状態", () => {
  beforeEach(() => {
    resetListening();
    vi.resetAllMocks();
  });

  it("張れたら生きている。外したら死ぬ", async () => {
    const unlisten = vi.fn();
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(unlisten);
    expect(isListeningForRepoUpdates()).toBe(false);

    const stop = await listenForRepoUpdates();
    expect(isListeningForRepoUpdates()).toBe(true);

    stop();
    expect(isListeningForRepoUpdates()).toBe(false);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  /**
   * StrictMode は購読を 2 本張って 1 本外す。真偽値で持つと、解決の順番によって
   * 「生きている購読があるのに false」になる (実機で踏んだ)
   */
  it("二重マウントで 1 本外れても生きている", async () => {
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(vi.fn());

    const first = await listenForRepoUpdates();
    const second = await listenForRepoUpdates();
    first();

    expect(isListeningForRepoUpdates()).toBe(true);
    second();
    expect(isListeningForRepoUpdates()).toBe(false);
  });

  it("同じ購読を 2 回外しても数がずれない", async () => {
    vi.mocked(onRepoSnapshotUpdated).mockResolvedValue(vi.fn());
    const stop = await listenForRepoUpdates();
    const other = await listenForRepoUpdates();

    stop();
    stop();

    expect(isListeningForRepoUpdates()).toBe(true);
    other();
    expect(isListeningForRepoUpdates()).toBe(false);
  });

  /** 購読できなければ「生きている」と言ってはいけない */
  it("張れなければ生きていない", async () => {
    vi.mocked(onRepoSnapshotUpdated).mockRejectedValue(new Error("権限がありません"));

    await expect(listenForRepoUpdates()).rejects.toThrow("権限がありません");
    expect(isListeningForRepoUpdates()).toBe(false);
  });
});

describe("`.git` の変化", () => {
  /** 届いたイベントを渡すハンドラを捕まえる */
  async function subscribe(): Promise<(repoIds: string[]) => void> {
    let handle: ((repoIds: string[]) => void) | null = null;
    vi.mocked(onReposChanged).mockImplementation((received) => {
      handle = received;
      return Promise.resolve(vi.fn());
    });
    await listenForRepoChanges();
    if (handle === null) throw new Error("ハンドラが渡されていない");
    return handle;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    resetRequests();
    vi.mocked(repos).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 9 }));
    useRepoStore.setState({
      byId: new Map(),
      order: [],
      loaded: false,
      loadError: null,
      running: new Map(),
    });
    useRepoStore
      .getState()
      .registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);
    useUiStore.setState({ windowVisible: true });
  });

  /** 変わったリポジトリだけ読む。全件読み直さない (docs/adr/0022-auto-refresh.md) */
  it("届いたリポジトリだけ取り直す", async () => {
    const changed = await subscribe();

    changed(["r2"]);
    await vi.waitFor(() => {
      expect(vi.mocked(repos).getRepoSnapshot).toHaveBeenCalledWith("r2");
    });

    expect(vi.mocked(repos).getRepoSnapshot).toHaveBeenCalledOnce();
  });

  /**
   * 閉じてもプロセスは残るので、見ていない間もイベントは届く
   * (docs/adr/0011-residency.md)。**そのたびに git を起こさない**
   */
  it("ウィンドウが隠れている間は取り直さない", async () => {
    const changed = await subscribe();
    useUiStore.setState({ windowVisible: false });

    changed(["r1"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(repos).getRepoSnapshot).not.toHaveBeenCalled();
  });

  /** 取り直しは操作の側が既にやっている (docs/adr/0009-concurrency-and-refresh.md) */
  it("実行中のリポジトリは取り直さない", async () => {
    const changed = await subscribe();
    useRepoStore.getState().beginRun("r1");

    changed(["r1", "r2"]);
    await vi.waitFor(() => {
      expect(vi.mocked(repos).getRepoSnapshot).toHaveBeenCalledWith("r2");
    });

    expect(vi.mocked(repos).getRepoSnapshot).toHaveBeenCalledOnce();
  });
});
