import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeOutcome, makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/events");

import { onRepoSnapshotUpdated } from "@/ipc/events";

import {
  applyRepoUpdate,
  isListeningForRepoUpdates,
  listenForRepoUpdates,
  resetListening,
} from "./events";
import { orderedRepos, useRepoStore } from "./useRepoStore";

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
      lastResult: new Map(),
      running: new Map(),
    });
    useRepoStore.getState().registerAll([registration("r1", "a")]);
    useRepoStore.getState().beginRun("r1");
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
    expect(useRepoStore.getState().lastResult.get("r1")?.ok).toBe(true);
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
    expect(useRepoStore.getState().lastResult.get("r1")?.message).toBe(
      "ディレクトリが見つかりません",
    );
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
