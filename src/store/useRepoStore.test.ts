import { beforeEach, describe, expect, it } from "vitest";

import type { RepoRegistration } from "@/ipc/generated/RepoRegistration";
import { makeSnapshot } from "@/test/factories";

import { createRepoStore, orderedRepos, type RepoStoreState } from "./useRepoStore";

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
});
