import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeSnapshot } from "@/test/factories";

vi.mock("@/ipc/repos");
vi.mock("@/ipc/ops");
// 中身は本物のまま。失敗経路を見るテストだけ 1 回差し替える
vi.mock("./bootstrap", { spy: true });

import * as ops from "@/ipc/ops";
import * as ipc from "@/ipc/repos";

import * as bootstrap from "./bootstrap";
import { resetRequests } from "./bootstrap";
import { refreshAllRepositories, refreshRepositories, resetRefreshing } from "./refresh";
import { isRunning, useRepoStore } from "./useRepoStore";

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
    reading: new Set(),
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
    useRepoStore.getState().beginRun("r1", "fetch");

    await refreshAllRepositories();

    expect(requested()).toEqual(["r2"]);
  });

  it("実行が終わっていれば読む", async () => {
    useRepoStore.getState().beginRun("r1", "fetch");
    useRepoStore.getState().endRun("r1", "fetch");

    await refreshAllRepositories();

    expect(requested().sort()).toEqual(["r1", "r2"]);
  });
});

describe("取り直しの最中の印", () => {
  /**
   * ステータスバーがこれを読んで「更新中」を出す
   * (docs/adr/0023-progress-in-the-status-bar.md)。
   * **`running` には入れない。** `.git` の変化のたびにボタンが灰色になる
   */
  it("読んでいる間だけ reading に入り、実行中の印は付かない", async () => {
    let during: { reading: string[]; running: boolean } | null = null;
    vi.mocked(ipc).getRepoSnapshot.mockImplementation((repoId) => {
      const state = useRepoStore.getState();
      during = { reading: [...state.reading], running: isRunning(state, repoId) };
      return Promise.resolve(makeSnapshot({ id: repoId, revision: 3 }));
    });

    await refreshRepositories(["r1"]);

    expect(during).toEqual({ reading: ["r1"], running: false });
    expect([...useRepoStore.getState().reading], "終わっても残っている").toEqual([]);
  });

  /**
   * 失敗しても印を外す。外さないと「更新中」が出たままになり、
   * そのリポジトリは以後ずっと重複排除に引っかかって取り直されなくなる。
   *
   * **`loadSnapshot` を差し替える。** `getRepoSnapshot` を reject させても
   * `loadSnapshot` が中で握って `failRepo` に落とすので、`finally` を通らない
   * (docs/store/bootstrap.ts)
   */
  it("読み取りが投げても印を外す", async () => {
    vi.mocked(bootstrap.loadSnapshot).mockRejectedValueOnce(new Error("読めません"));

    await expect(refreshRepositories(["r1"])).rejects.toThrow("読めません");

    expect([...useRepoStore.getState().reading]).toEqual([]);
  });
});

/*
 * やり直し (docs/adr/0022-auto-refresh.md)。
 *
 * 読んでいる最中に来た分は、終わってから 1 回やり直す。
 * **やり直しの前にもう一度見る。** 読んでいる間に状況は変わる。
 */
describe("やり直しの入口", () => {
  /** 読み終わるまで待たせる。その間にストアを動かす */
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

  /** `remove` が `reading` を掃除した意図を、やり直しが打ち消さない */
  it("読んでいる間にリストから消えたら、やり直さない", async () => {
    const first = pending();
    const running = refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);

    useRepoStore.getState().remove("r1");
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 4 }));
    first.resolve();
    await running;

    expect(requested()).toEqual(["r1"]);
    expect([...useRepoStore.getState().reading], "消したはずの id が入り直している").toEqual([]);
  });

  /** 取り直しはボタンを無効にしないので、読んでいる間に書き込みが始まり得る */
  it("読んでいる間に書き込みが始まったら、やり直さない", async () => {
    const first = pending();
    const running = refreshRepositories(["r1"]);
    await refreshRepositories(["r1"]);

    useRepoStore.getState().beginRun("r1", "checkout");
    vi.mocked(ipc).getRepoSnapshot.mockResolvedValue(makeSnapshot({ id: "r1", revision: 4 }));
    first.resolve();
    await running;

    expect(requested()).toEqual(["r1"]);
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
    useRepoStore.getState().beginRun("r2", "fetch");

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
