import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/repos");
vi.mock("@/ipc/ops");

import * as ops from "@/ipc/ops";
import * as ipc from "@/ipc/repos";

import { resetRequests } from "./bootstrap";
import { refreshAllRepositories, refreshRepositories, resetRefreshing } from "./refresh";
import { useRepoStore } from "./useRepoStore";

/*
 * 更新 (docs/adr/0022-auto-refresh.md)。
 *
 * 引き金は 3 つあるが、落ちる先はここ 1 本。**フェッチはしない。**
 */

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

/** 取り直しに行った id を、呼ばれた順に返す */
function requested(): string[] {
  return vi.mocked(ipc).getRepoSnapshot.mock.calls.map(([id]) => id);
}

beforeEach(() => {
  vi.mocked(ipc).getRepoSnapshot.mockReset();
  vi.mocked(ipc).getRepoSnapshot.mockImplementation((repoId) =>
    Promise.resolve(makeSnapshot({ id: repoId, revision: 2 })),
  );
  vi.mocked(ops).fetchRepo.mockReset();
  vi.mocked(ops).fetchAll.mockReset();
  resetRequests();
  resetRefreshing();
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
});

describe("全リポジトリの更新", () => {
  it("登録済みを全件取り直す", async () => {
    await refreshAllRepositories();

    expect(requested().sort()).toEqual(["r1", "r2"]);
    expect(useRepoStore.getState().byId.get("r1")?.snapshot?.revision).toBe(2);
  });

  /** ネットワークを触るのはユーザーが明示的にフェッチしたときだけ (ADR-0022) */
  it("フェッチはしない", async () => {
    await refreshAllRepositories();

    expect(vi.mocked(ops).fetchRepo).not.toHaveBeenCalled();
    expect(vi.mocked(ops).fetchAll).not.toHaveBeenCalled();
  });

  /**
   * 操作の側が終わったときに取り直す (docs/adr/0009-concurrency-and-refresh.md)。
   * ここでも読むと、同じリポジトリの読み取りが二重に走る
   */
  it("実行中のリポジトリは読まない", async () => {
    useRepoStore.getState().beginRun("r1");

    await refreshAllRepositories();

    expect(requested()).toEqual(["r2"]);
  });

  it("実行が終わっていれば読む", async () => {
    useRepoStore.getState().beginRun("r1");
    useRepoStore.getState().endRun("r1");

    await refreshAllRepositories();

    expect(requested().sort()).toEqual(["r1", "r2"]);
  });
});

describe("指定したリポジトリの更新", () => {
  /** `.git` の監視は変わったリポジトリだけを知らせる (ADR-0022) */
  it("渡した id だけ取り直す", async () => {
    await refreshRepositories(["r2"]);

    expect(requested()).toEqual(["r2"]);
  });

  /** 監視のイベントは、リストから消したあとに遅れて届き得る */
  it("知らない id は読まない", async () => {
    await refreshRepositories(["r404"]);

    expect(requested()).toEqual([]);
  });

  it("実行中のリポジトリは読まない", async () => {
    useRepoStore.getState().beginRun("r2");

    await refreshRepositories(["r1", "r2"]);

    expect(requested()).toEqual(["r1"]);
  });
});

/*
 * 読み取りには重複排除が無い。「更新」を連打すると、投げた分だけ Rust 側に届く
 * (docs/adr/0009-concurrency-and-refresh.md の読み取りの枠は 4)。
 */
describe("連打", () => {
  /** 待たせておくスナップショットの解決口 */
  function pending(): { resolve: () => void } {
    let release = (): void => undefined;
    vi.mocked(ipc).getRepoSnapshot.mockImplementation(
      (repoId) =>
        new Promise((done) => {
          release = () => done(makeSnapshot({ id: repoId, revision: 3 }));
        }),
    );
    return {
      resolve: () => {
        release();
      },
    };
  }

  it("読んでいる最中の分は積まない", async () => {
    const first = pending();
    const running = refreshRepositories(["r1"]);

    await refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);

    expect(requested()).toEqual(["r1"]);

    // 後始末。やり直しの 1 本まで終わらせてから抜ける
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 4 }));
    first.resolve();
    await running;
  });

  /**
   * **捨てずに 1 回やり直す。** 走っている読み取りは、求められた変化より前の
   * 状態を見ているかもしれない
   */
  it("読んでいる最中に求められたら、終わってから 1 回だけやり直す", async () => {
    const first = pending();
    const running = refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);

    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 4 }));
    first.resolve();
    await running;

    expect(requested()).toEqual(["r1", "r1"]);
  });

  it("終わったあとはまた読む", async () => {
    await refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);

    expect(requested()).toEqual(["r1", "r1"]);
  });
});
