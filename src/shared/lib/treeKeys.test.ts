import { describe, expect, it } from "vitest";

import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";

import {
  allKeys,
  allKeysOf,
  close,
  defaultExpanded,
  directoryKey,
  directoryPaths,
  isUnder,
  leafKey,
  open,
  renamedLeafKey,
  repoKey,
  sectionKey,
} from "./treeKeys";

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    id: "r1",
    name: "acme-api",
    path: "/repos/acme-api",
    origin_url: null,
    local: [],
    remote: [],
    tags: [],
    worktrees: [],
    changes: { items: [], total: 0 },
    fetched_at: null,
    revision: 1,
    head: { kind: "branch", name: "main" },
    ...overrides,
  };
}

function repoState(id: string, local: string[]) {
  return {
    id,
    name: id,
    path: `/repos/${id}`,
    status: "ready" as const,
    snapshot: snapshot({ id, local: local.map((name) => branch(name)) }),
    error: null,
    running: false,
  };
}

function branch(name: string) {
  return {
    name,
    is_current: false,
    behind: 0,
    ahead: 0,
    upstream: null,
    upstream_gone: false,
    committed_at: 0,
    worktree_path: null,
  };
}

describe("鍵の形", () => {
  it("スコープとパスを `|` でつなぐ", () => {
    expect(repoKey("r1")).toBe("r1|repo|");
    expect(sectionKey("r1", "local")).toBe("r1|local|");
    expect(directoryKey("r1", "remote", "origin/feature")).toBe("r1|remote|origin/feature");
    expect(leafKey("r1", "tag", "v1.0.0")).toBe("r1|tag|leaf|v1.0.0");
  });

  it("葉とディレクトリの鍵が衝突しない", () => {
    expect(leafKey("r1", "local", "feature")).not.toBe(directoryKey("r1", "local", "feature"));
  });
});

describe("isUnder", () => {
  it("リポジトリの鍵は同じ id の全スコープを配下に持つ", () => {
    expect(isUnder("r1|local|", repoKey("r1"))).toBe(true);
    expect(isUnder("r1|remote|origin", repoKey("r1"))).toBe(true);
    expect(isUnder("r2|local|", repoKey("r1"))).toBe(false);
  });

  it("id の前方一致で他のリポジトリを巻き込まない", () => {
    expect(isUnder("r10|local|", repoKey("r1"))).toBe(false);
  });

  it("括りの配下は同じスコープだけ", () => {
    expect(isUnder("r1|local|feature", sectionKey("r1", "local"))).toBe(true);
    expect(isUnder("r1|remote|origin", sectionKey("r1", "local"))).toBe(false);
  });

  it("ディレクトリの配下はその下のパスだけ", () => {
    const key = directoryKey("r1", "local", "feature");

    expect(isUnder(directoryKey("r1", "local", "feature/rec-482"), key)).toBe(true);
    expect(isUnder(directoryKey("r1", "local", "feature-flags"), key)).toBe(false);
    expect(isUnder(key, key)).toBe(false);
  });
});

describe("`|` を含む名前", () => {
  it("鍵を分解せず前方一致で判定する (git は ref 名に `|` を許す)", () => {
    const directory = directoryKey("r1", "local", "feat|x");
    const child = directoryKey("r1", "local", "feat|x/y");
    const other = directoryKey("r1", "local", "feat");

    expect(isUnder(child, directory)).toBe(true);
    expect(isUnder(directory, other)).toBe(false);
  });

  it("`|` を含む名前を閉じても、他のディレクトリは残る", () => {
    const expanded = new Set([
      "r1|repo|",
      "r1|local|",
      directoryKey("r1", "local", "feat|x"),
      directoryKey("r1", "local", "feat|x/y"),
      directoryKey("r1", "local", "other"),
    ]);

    const closed = close(expanded, directoryKey("r1", "local", "feat|x"));

    expect([...closed].sort()).toEqual(["r1|local|", "r1|local|other", "r1|repo|"]);
  });

  it("葉の鍵に `|` が入っても、ディレクトリの鍵と混ざらない", () => {
    expect(leafKey("r1", "local", "feat|x")).toBe("r1|local|leaf|feat|x");
    expect(isUnder(leafKey("r1", "local", "feat|x"), directoryKey("r1", "local", "feat"))).toBe(
      false,
    );
  });
});

describe("開閉", () => {
  it("開くのはその鍵だけ", () => {
    expect([...open(new Set(["r1|repo|"]), "r1|local|")].sort()).toEqual(["r1|local|", "r1|repo|"]);
  });

  it("閉じたら配下も全部閉じる", () => {
    const expanded = new Set([
      "r1|repo|",
      "r1|local|",
      "r1|local|feature",
      "r1|remote|",
      "r2|repo|",
    ]);

    expect([...close(expanded, "r1|repo|")]).toEqual(["r2|repo|"]);
  });

  it("括りを閉じても他のスコープは残る", () => {
    const expanded = new Set(["r1|repo|", "r1|local|", "r1|local|feature", "r1|remote|"]);

    expect([...close(expanded, "r1|local|")].sort()).toEqual(["r1|remote|", "r1|repo|"]);
  });

  it("開き直しても子は閉じたまま (docs/specs/ui.md)", () => {
    const expanded = new Set(["r1|repo|", "r1|local|", "r1|local|feature"]);

    const reopened = open(close(expanded, "r1|local|"), "r1|local|");

    expect(reopened.has("r1|local|feature")).toBe(false);
  });
});

describe("directoryPaths", () => {
  it("階層のすべての段を作る", () => {
    expect(directoryPaths(["feature/rec-482/api", "develop"]).sort()).toEqual([
      "feature",
      "feature/rec-482",
    ]);
  });

  it("同じ段を重複させない", () => {
    expect(directoryPaths(["feature/a", "feature/b"])).toEqual(["feature"]);
  });

  it("階層が無ければ空", () => {
    expect(directoryPaths(["main", "develop"])).toEqual([]);
  });
});

describe("defaultExpanded", () => {
  it("見出しとローカルだけ開く。リモートとタグは閉じたまま", () => {
    const keys = defaultExpanded(
      "r1",
      snapshot({
        local: [branch("feature/rec-482"), branch("main")],
        remote: [{ name: "origin/main", committed_at: 0 }],
        tags: [{ name: "v1.0.0", committed_at: 0 }],
      }),
    );

    expect(keys.sort()).toEqual(["r1|local|", "r1|local|feature", "r1|repo|"]);
  });
});

describe("allKeys", () => {
  it("渡したスコープの折りたためる鍵を全部集める", () => {
    const keys = allKeys(
      "r1",
      snapshot({
        local: [branch("feature/a")],
        remote: [{ name: "origin/feature/b", committed_at: 0 }],
        tags: [{ name: "v1.0.0", committed_at: 0 }],
      }),
      ["local", "remote", "tag"],
    );

    expect(keys.sort()).toEqual([
      "r1|local|",
      "r1|local|feature",
      "r1|remote|",
      "r1|remote|origin",
      "r1|remote|origin/feature",
      "r1|repo|",
      "r1|tag|",
    ]);
  });

  it("ローカルだけを渡せばリモートとタグは開かない", () => {
    const keys = allKeys(
      "r1",
      snapshot({
        local: [branch("main")],
        remote: [{ name: "origin/main", committed_at: 0 }],
      }),
      ["local"],
    );

    expect(keys.sort()).toEqual(["r1|local|", "r1|repo|"]);
  });

  it("中身が無い括りの鍵は作らない", () => {
    const keys = allKeys("r1", snapshot({ local: [branch("main")] }), ["local", "remote", "tag"]);

    expect(keys.sort()).toEqual(["r1|local|", "r1|repo|"]);
  });
});

describe("renamedLeafKey", () => {
  it("葉の名前だけを差し替える", () => {
    expect(renamedLeafKey("r1|local|leaf|develop", "trunk")).toBe("r1|local|leaf|trunk");
    expect(renamedLeafKey("r1|local|leaf|feature/a", "feature/b")).toBe("r1|local|leaf|feature/b");
  });

  /** **ブランチ名には `|` が入れられる** (docs/specs/data-model.md) */
  it("名前に `|` が入っていても壊れない", () => {
    expect(renamedLeafKey("r1|local|leaf|a|b", "c|d")).toBe("r1|local|leaf|c|d");
  });

  it("葉ではない鍵はそのまま返す", () => {
    expect(renamedLeafKey("r1|local|feature", "x")).toBe("r1|local|feature");
    expect(renamedLeafKey("r1|repo|", "x")).toBe("r1|repo|");
  });
});

describe("allKeysOf", () => {
  it("全リポジトリの鍵を集める", () => {
    const keys = allKeysOf([repoState("r1", ["feature/a"]), repoState("r2", ["main"])], ["local"]);

    expect(keys.sort()).toEqual([
      "r1|local|",
      "r1|local|feature",
      "r1|repo|",
      "r2|local|",
      "r2|repo|",
    ]);
  });

  it("読み込みが終わっていないリポジトリは見出しだけ開く", () => {
    const loading = {
      id: "r9",
      name: "loading",
      path: "/repos/loading",
      status: "loading" as const,
      snapshot: null,
      error: null,
      running: false,
    };

    expect(allKeysOf([loading], ["local"])).toEqual(["r9|repo|"]);
  });
});
