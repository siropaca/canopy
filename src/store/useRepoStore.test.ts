import { beforeEach, describe, expect, it } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeSnapshot } from "@/test/factories";

import { createRepoStore, isRunning, orderedRepos, type RepoStoreState } from "./useRepoStore";

function registration(id: string, name: string): RepoRegistration {
  return { id, name, path: `/repos/${name}` };
}

describe("リポジトリのストア", () => {
  let store: ReturnType<typeof createRepoStore>;
  const state = (): RepoStoreState => store.getState();

  beforeEach(() => {
    store = createRepoStore();
  });

  it("登録情報だけで見出しを描ける状態にする (docs/specs/ui.md)", () => {
    state().registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);

    const repos = orderedRepos(state());
    expect(repos.map((repo) => [repo.name, repo.status])).toEqual([
      ["acme-api", "loading"],
      ["acme-web", "loading"],
    ]);
    expect(repos.every((repo) => repo.snapshot === null)).toBe(true);
  });

  it("スナップショットが届いた分だけ ready になる", () => {
    state().registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);

    state().applySnapshot(makeSnapshot({ id: "r1", name: "acme-api" }));

    expect(state().byId.get("r1")?.status).toBe("ready");
    expect(state().byId.get("r2")?.status).toBe("loading");
  });

  it("古い世代のスナップショットを捨てる (docs/adr/0009-concurrency-and-refresh.md)", () => {
    state().registerAll([registration("r1", "acme-api")]);
    state().applySnapshot(makeSnapshot({ id: "r1", revision: 5 }));

    state().applySnapshot(makeSnapshot({ id: "r1", revision: 4, name: "古い" }));

    expect(state().byId.get("r1")?.snapshot?.revision).toBe(5);
    expect(state().byId.get("r1")?.name).toBe("acme-api");
  });

  it("同じ世代も捨てる。取り直した結果だけを採る", () => {
    state().registerAll([registration("r1", "acme-api")]);
    state().applySnapshot(makeSnapshot({ id: "r1", revision: 2 }));

    state().applySnapshot(makeSnapshot({ id: "r1", revision: 2, name: "同じ世代" }));

    expect(state().byId.get("r1")?.name).toBe("acme-api");
  });

  it("新しい世代は受け入れる", () => {
    state().registerAll([registration("r1", "acme-api")]);
    state().applySnapshot(makeSnapshot({ id: "r1", revision: 1 }));

    state().applySnapshot(makeSnapshot({ id: "r1", revision: 2, name: "新しい" }));

    expect(state().byId.get("r1")?.name).toBe("新しい");
  });

  it("知らない id のスナップショットは無視する", () => {
    state().registerAll([registration("r1", "acme-api")]);

    state().applySnapshot(makeSnapshot({ id: "r404" }));

    expect(state().byId.has("r404")).toBe(false);
  });

  it("1 件の失敗で他のリポジトリを落とさない", () => {
    state().registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);
    state().applySnapshot(makeSnapshot({ id: "r2", name: "acme-web" }));

    state().failRepo("r1", "ディレクトリが見つかりません");

    expect(state().byId.get("r1")?.status).toBe("error");
    expect(state().byId.get("r1")?.error).toBe("ディレクトリが見つかりません");
    // 見出しを消さない。消すと repo_order に id が残って不整合になる
    expect(state().byId.get("r1")?.name).toBe("acme-api");
    expect(state().byId.get("r2")?.status).toBe("ready");
  });

  it("失敗したあとに届いたスナップショットで復帰する", () => {
    state().registerAll([registration("r1", "acme-api")]);
    state().failRepo("r1", "ディレクトリが見つかりません");

    state().applySnapshot(makeSnapshot({ id: "r1", revision: 1 }));

    expect(state().byId.get("r1")?.status).toBe("ready");
    expect(state().byId.get("r1")?.error).toBeNull();
  });

  it("追加した 1 件を末尾に足す", () => {
    state().registerAll([registration("r1", "acme-api")]);

    state().register(registration("r2", "acme-web"));

    expect(state().order).toEqual(["r1", "r2"]);
  });

  it("削除すると並び順からも消える", () => {
    state().registerAll([registration("r1", "acme-api"), registration("r2", "acme-web")]);

    state().remove("r1");

    expect(state().order).toEqual(["r2"]);
    expect(state().byId.has("r1")).toBe(false);
  });

  it("並び替えを反映する", () => {
    state().registerAll([registration("r1", "a"), registration("r2", "b")]);

    state().setOrder(["r2", "r1"]);

    expect(state().order).toEqual(["r2", "r1"]);
  });

  it("並び替えで渡されなかった id を消さない", () => {
    state().registerAll([registration("r1", "a"), registration("r2", "b")]);

    state().setOrder(["r2"]);

    expect(state().order).toEqual(["r2", "r1"]);
  });

  it("並び替えで知らない id を混ぜない", () => {
    state().registerAll([registration("r1", "a")]);

    state().setOrder(["r404", "r1"]);

    expect(state().order).toEqual(["r1"]);
  });

  /*
   * 取り直しの最中 (docs/adr/0023-progress-in-the-status-bar.md)。
   *
   * **`running` とは分ける。** `.git` の変化で頻繁に走るので、混ぜると
   * ボタンがそのたびに無効になる (docs/adr/0022-auto-refresh.md)。
   */
  describe("取り直しの最中", () => {
    beforeEach(() => {
      state().registerAll([registration("r1", "a"), registration("r2", "b")]);
    });

    it("始めたリポジトリだけ入る。終わると抜ける", () => {
      state().beginRead("r1");

      expect([...state().reading]).toEqual(["r1"]);

      state().endRead("r1");
      expect([...state().reading]).toEqual([]);
    });

    /** **ボタンを無効にしない。** ここが効くと `.git` の変化のたびに灰色になる */
    it("実行中の印は付かない", () => {
      state().beginRead("r1");

      expect(isRunning(state(), "r1")).toBe(false);
      expect(orderedRepos(state()).find((repo) => repo.id === "r1")?.running).toBe(false);
    });

    it("同じ id を 2 回始めても 1 件", () => {
      state().beginRead("r1");
      state().beginRead("r1");

      expect([...state().reading]).toEqual(["r1"]);
    });

    it("リストから消したら取り直しの最中も外す", () => {
      state().beginRead("r1");

      state().remove("r1");

      expect([...state().reading]).toEqual([]);
    });
  });

  describe("実行中", () => {
    /** 実行中は本数が正で、`orderedRepos` が写す */
    const runningOf = (id: string): boolean | undefined =>
      orderedRepos(state()).find((repo) => repo.id === id)?.running;

    beforeEach(() => {
      state().registerAll([registration("r1", "a"), registration("r2", "b")]);
    });

    it("始めたリポジトリだけ実行中になる", () => {
      state().beginRun("r1", "fetch");

      expect(runningOf("r1")).toBe(true);
      expect(runningOf("r2")).toBe(false);
    });

    it("終わったら解ける", () => {
      state().beginRun("r1", "fetch");
      state().endRun("r1", "fetch");

      expect(runningOf("r1")).toBe(false);
    });

    /**
     * 一括フェッチとユーザーの操作が重なったとき、真偽値で持つと
     * 先に終わった方が実行中の表示を消してしまう
     */
    it("2 本重なったら、両方終わるまで解けない", () => {
      state().beginRun("r1", "fetch");
      state().beginRun("r1", "fetch");

      state().endRun("r1", "fetch");
      expect(runningOf("r1")).toBe(true);

      state().endRun("r1", "fetch");
      expect(runningOf("r1")).toBe(false);
    });

    /** ステータスバーが読む (docs/adr/0023-progress-in-the-status-bar.md) */
    it("何をしているかを覚えている", () => {
      state().beginRun("r1", "push");
      state().beginRun("r1", "fetch");

      expect(state().running.get("r1")).toEqual(["push", "fetch"]);

      state().endRun("r1", "push");
      expect(state().running.get("r1"), "終わった 1 本だけ抜く").toEqual(["fetch"]);

      state().endRun("r1", "fetch");
      expect(state().running.has("r1"), "空の列を残さない").toBe(false);
    });

    /**
     * **先に始めた方が先に終わるとは限らない。** 末尾を抜くと、残る側が
     * 走っていない操作を指してステータスバーがそれを出す
     */
    it("終わった操作を名指しで抜く。順番が入れ替わってもずれない", () => {
      state().beginRun("r1", "push");
      state().beginRun("r1", "fetch");

      // 後から始めたフェッチではなく、先に始めたプッシュが終わる
      state().endRun("r1", "push");

      expect(state().running.get("r1")).toEqual(["fetch"]);
    });

    it("同じ操作が 2 本あれば 1 本だけ抜く", () => {
      state().beginRun("r1", "fetch");
      state().beginRun("r1", "fetch");

      state().endRun("r1", "fetch");

      expect(state().running.get("r1")).toEqual(["fetch"]);
    });

    /** 走っていない操作を渡されても、他の 1 本を巻き込まない */
    it("走っていない操作の終了は何もしない", () => {
      state().beginRun("r1", "push");

      state().endRun("r1", "fetch");

      expect(state().running.get("r1")).toEqual(["push"]);
      expect(runningOf("r1")).toBe(true);
    });

    it("余分に終了しても負にならない", () => {
      state().endRun("r1", "fetch");
      state().endRun("r1", "fetch");
      state().beginRun("r1", "fetch");

      expect(runningOf("r1")).toBe(true);
      state().endRun("r1", "fetch");
      expect(runningOf("r1")).toBe(false);
    });

    /**
     * **`RepoState` を作り直す経路で実行中を落とさない。**
     * 手で写す形だと、経路を足すたびに写し忘れが増える
     */
    it("スナップショットが届いても、登録し直しても実行中のまま", () => {
      state().beginRun("r1", "fetch");

      state().applySnapshot(makeSnapshot({ id: "r1", revision: 2 }));
      expect(runningOf("r1")).toBe(true);

      state().register(registration("r1", "a"));
      expect(runningOf("r1")).toBe(true);

      state().registerAll([registration("r1", "a"), registration("r2", "b")]);
      expect(runningOf("r1")).toBe(true);
    });

    it("同じ状態なら同じオブジェクトを返す (無駄な再描画を起こさない)", () => {
      const before = orderedRepos(state());

      const after = orderedRepos(state());

      expect(after[0]).toBe(before[0]);
    });

    /**
     * **実行中でも同じオブジェクトを返す。**
     *
     * 呼ぶたびに新しい行を作ると `useShallow` の比較が毎回外れて、
     * 再描画 -> 比較 -> 再描画 の無限ループになる (実機で画面が真っ白になった)。
     */
    it("実行中でも、状態が変わっていなければ同じオブジェクトを返す", () => {
      state().registerAll([registration("r1", "a")]);
      state().beginRun("r1", "fetch");

      const before = orderedRepos(state());
      const after = orderedRepos(state());

      expect(before[0]?.running).toBe(true);
      expect(after[0]).toBe(before[0]);
    });

    it("実行中が解けたら元のオブジェクトに戻る", () => {
      state().registerAll([registration("r1", "a")]);
      const idle = orderedRepos(state());

      state().beginRun("r1", "fetch");
      const running = orderedRepos(state());
      state().endRun("r1", "fetch");

      expect(running[0]).not.toBe(idle[0]);
      expect(orderedRepos(state())[0]).toBe(idle[0]);
    });
  });

  describe("リストからの削除", () => {
    it("実行中の印も消す", () => {
      state().registerAll([registration("r1", "a")]);
      state().beginRun("r1", "fetch");

      state().remove("r1");

      expect(state().running.has("r1")).toBe(false);
    });
  });
});
