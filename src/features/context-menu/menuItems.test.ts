import { describe, expect, it } from "vitest";

import type { RepoState, RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import { makeBranch, makeRef, makeRepo, makeWorktree } from "@/test/factories";

import { type MenuItem, menuItemsFor } from "./menuItems";

function build(repo: RepoState): RowNode[] {
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local", "remote", "tag"])),
    query: "",
    groupDirectories: false,
    localOnly: false,
  });
}

const REPO = makeRepo("r1", {
  name: "acme-api",
  path: "/repos/acme-api",
  origin_url: "https://github.com/acme/acme-api",
  local: [makeBranch("main", { is_current: true }), makeBranch("feature/a")],
  remote: [makeRef("origin/develop")],
  tags: [makeRef("v1.0.0")],
});

function itemsFor(
  kind: RowNode["kind"],
  label?: string,
  repo: RepoState = REPO,
  options: { readonly bulkFetchRunning?: boolean } = {},
): MenuItem[] {
  const row = build(repo).find(
    (item) => item.kind === kind && (label === undefined || labelOf(item) === label),
  );
  if (row === undefined) throw new Error(`${kind} ${label ?? ""} の行が無い`);
  return menuItemsFor(row, repo, options);
}

function labelOf(row: RowNode): string {
  if (row.kind === "repo") return row.repo.name;
  if (row.kind === "branch") return row.branch.name;
  if (row.kind === "remote" || row.kind === "tag") return row.reference.name;
  return row.label;
}

/** 押せる項目のラベル */
function enabled(items: MenuItem[]): string[] {
  return items
    .filter((item) => item.kind === "action" && !item.disabled)
    .map((item) => (item.kind === "action" ? item.label : ""));
}

/** グレーで置いてある項目のラベル */
function greyed(items: MenuItem[]): string[] {
  const found: string[] = [];
  for (const item of items) {
    if (item.kind === "v2") found.push(item.label);
    if (item.kind === "action" && item.disabled) found.push(item.label);
  }
  return found;
}

describe("現在のブランチ", () => {
  const items = itemsFor("branch", "main");

  it("並びと文言が仕様どおり (docs/specs/ui.md)", () => {
    expect(labels(items)).toEqual([
      "プル",
      "プッシュ",
      "──",
      "origin/main でリベース",
      "──",
      "ブランチ名をコピー",
      "名前の変更",
      "──",
      "新規ブランチ",
      "作業ツリーとの差分を表示",
    ]);
  });

  it("チェックアウトは出さない (すでにそこにいる)", () => {
    expect(labels(items)).not.toContain("チェックアウト");
  });

  /** 値を薄く出すのはリポジトリ見出しのサブメニューだけ (docs/specs/ui.md) */
  it("ブランチ名をコピーには値を出さない", () => {
    const copy = items.find(
      (item) => item.kind === "action" && item.label === "ブランチ名をコピー",
    );
    if (copy?.kind !== "action") throw new Error("コピーの項目が無い");

    expect(copy.value).toBeUndefined();
  });

  it("v2 の項目はグレー", () => {
    expect(greyed(items)).toEqual([
      "origin/main でリベース",
      "新規ブランチ",
      "作業ツリーとの差分を表示",
    ]);
  });
});

describe("他のローカルブランチ", () => {
  const items = itemsFor("branch", "feature/a");

  it("並びと文言が仕様どおり", () => {
    expect(labels(items)).toEqual([
      "チェックアウト",
      "チェックアウトとプル",
      "'feature/a' から新規ブランチ",
      "──",
      "'feature/a' で 'main' をリベース",
      "'feature/a' を 'main' にマージ",
      "──",
      "プル",
      "プッシュ",
      "──",
      "ブランチ名をコピー",
      "名前の変更",
      "──",
      "削除",
    ]);
  });

  /**
   * 削除は v1 に入れた (docs/adr/0021-delete-local-branch.md)。
   * v2 のグレーではなく、押せる項目にする
   */
  it("削除は押せる項目になっている", () => {
    expect(enabled(items)).toContain("削除");
  });

  it("`⧉` が付いていたらチェックアウトを無効にする", () => {
    const held = makeRepo("r1", {
      local: [
        makeBranch("main", { is_current: true }),
        makeBranch("held", { worktree_path: "/wt/held" }),
      ],
      worktrees: [makeWorktree("held", "/wt/held")],
    });

    const items = itemsFor("branch", "held", held);

    expect(greyed(items)).toContain("チェックアウト");
    expect(greyed(items)).toContain("チェックアウトとプル");
    expect(enabled(items)).toContain("プル");
    // git が `used by worktree at` で必ず拒否する
    expect(greyed(items)).toContain("削除");
  });

  it("`gone` のブランチはプルを無効にする", () => {
    const gone = makeRepo("r1", {
      local: [makeBranch("main", { is_current: true }), makeBranch("old", { upstream_gone: true })],
    });

    const items = itemsFor("branch", "old", gone);

    expect(greyed(items)).toContain("プル");
    expect(enabled(items)).toContain("チェックアウト");
  });
});

describe("リモートブランチ", () => {
  const items = itemsFor("remote", "origin/develop");

  it("並びと文言が仕様どおり", () => {
    expect(labels(items)).toEqual([
      "チェックアウト",
      "'origin/develop' から新規ブランチ",
      "──",
      "'origin/develop' で 'main' をリベース",
      "'origin/develop' を 'main' にマージ",
      "──",
      "ブランチ名をコピー",
      "──",
      "削除",
    ]);
  });

  it("プルとプッシュと名前の変更は出さない", () => {
    for (const label of ["プル", "プッシュ", "名前の変更"]) {
      expect(labels(items)).not.toContain(label);
    }
  });
});

describe("タグ", () => {
  const items = itemsFor("tag", "v1.0.0");

  it("並びと文言が仕様どおり", () => {
    expect(labels(items)).toEqual([
      "チェックアウト",
      "'v1.0.0' から新規ブランチ",
      "──",
      "タグ名をコピー",
      "──",
      "削除",
    ]);
  });
});

describe("リポジトリ見出し", () => {
  const items = itemsFor("repo");

  /** 押せると同じ操作が積まれて、集約したトーストの件数が実際と合わなくなる */
  it("一括フェッチの最中は「すべてフェッチ」を無効にする", () => {
    const running = itemsFor("repo", undefined, REPO, { bulkFetchRunning: true });

    expect(greyed(running)).toContain("すべてフェッチ");
    expect(enabled(items)).toContain("すべてフェッチ");
  });

  it("並びと文言が仕様どおり", () => {
    expect(labels(items)).toEqual([
      "このリポジトリをフェッチ",
      "プル",
      "──",
      "すべてフェッチ",
      "──",
      "パス/参照のコピー",
      "見出しの色",
      "──",
      "Finder で表示",
      "ターミナルで開く",
      "──",
      "リポジトリを追加",
      "リストから削除",
    ]);
  });

  it("コピーはサブメニュー。項目の右に実際の値を出す", () => {
    const submenu = submenuOf(items, "パス/参照のコピー");

    expect(labels([...submenu.items])).toEqual([
      "コピー",
      "絶対パス",
      "リポジトリ名",
      "──",
      "GitHub リポジトリ URL",
    ]);
    const values = submenu.items
      .filter((item) => item.kind === "action")
      .map((item) => (item.kind === "action" ? item.value : undefined));
    expect(values).toEqual(["/repos/acme-api", "acme-api", "https://github.com/acme/acme-api"]);
  });

  it("origin が無ければ URL の項目を出さない", () => {
    const noRemote = makeRepo("r1", { origin_url: null, local: [makeBranch("main")] });

    const submenu = submenuOf(itemsFor("repo", undefined, noRemote), "パス/参照のコピー");

    expect(labels([...submenu.items])).toEqual(["コピー", "絶対パス", "リポジトリ名"]);
  });

  /** 7 択。`なし` が先頭 (docs/adr/0024-repo-heading-color.md) */
  it("見出しの色はサブメニュー。なしと 6 色を並べる", () => {
    const submenu = submenuOf(items, "見出しの色");

    expect(labels([...submenu.items])).toEqual(["なし", "赤", "オレンジ", "黄", "緑", "青", "紫"]);
  });

  it("見出しの色の項目は、その色を付ける操作になる。なしは外す", () => {
    const submenu = submenuOf(items, "見出しの色");

    const actions = submenu.items.map((item) => (item.kind === "action" ? item.action : null));

    expect(actions).toEqual([
      { type: "setColor", color: null },
      { type: "setColor", color: "red" },
      { type: "setColor", color: "orange" },
      { type: "setColor", color: "yellow" },
      { type: "setColor", color: "green" },
      { type: "setColor", color: "blue" },
      { type: "setColor", color: "purple" },
    ]);
  });

  /** 見本は見出しに塗る色そのもの。なしは既定のグレー */
  it("見出しの色の項目に色見本を付ける", () => {
    const submenu = submenuOf(items, "見出しの色");

    const swatches = submenu.items.map((item) => (item.kind === "action" ? item.swatch : null));

    expect(swatches).toEqual(["none", "red", "orange", "yellow", "green", "blue", "purple"]);
  });

  it("detached HEAD のときだけ「直前のブランチに戻る」を出す", () => {
    const detached = makeRepo("r1", {
      local: [makeBranch("main")],
      head: { kind: "detached", name: "v1.0.0" },
    });

    expect(labels(itemsFor("repo", undefined, detached))).toContain("直前のブランチに戻る");
    expect(labels(itemsFor("repo"))).not.toContain("直前のブランチに戻る");
  });

  /** 実行中でも項目は消さない。並びが変わると押し間違える */
  it("実行中の detached HEAD では「直前のブランチに戻る」をグレーで置く", () => {
    const detached = makeRepo(
      "r1",
      { local: [makeBranch("main")], head: { kind: "detached", name: "v1.0.0" } },
      { running: true },
    );

    const items = itemsFor("repo", undefined, detached);

    expect(labels(items)).toContain("直前のブランチに戻る");
    expect(greyed(items)).toContain("直前のブランチに戻る");
  });

  it("読み込み中でもフェッチと削除は押せて、プルは無効", () => {
    const loading = makeRepo("r1", { local: [] }, { status: "loading", snapshot: null });

    const items = itemsFor("repo", undefined, loading);

    expect(enabled(items)).toContain("このリポジトリをフェッチ");
    expect(enabled(items)).toContain("リストから削除");
    expect(greyed(items)).toContain("プル");
  });
});

describe("実行中のリポジトリ", () => {
  it("操作の項目がすべてグレーになる (docs/specs/ui.md の「実行中の扱い」)", () => {
    const running = makeRepo(
      "r1",
      { local: [makeBranch("main", { is_current: true }), makeBranch("feature/a")] },
      { running: true },
    );

    expect(greyed(itemsFor("branch", "main", running))).toContain("プル");
    expect(greyed(itemsFor("branch", "main", running))).toContain("プッシュ");
    expect(greyed(itemsFor("branch", "feature/a", running))).toContain("チェックアウト");
    expect(greyed(itemsFor("repo", undefined, running))).toContain("このリポジトリをフェッチ");
  });

  it("コピーと Finder は止めない (git を実行しない)", () => {
    const running = makeRepo("r1", { local: [makeBranch("main")] }, { running: true });

    expect(enabled(itemsFor("repo", undefined, running))).toContain("Finder で表示");
  });

  it("見出しの色も止めない (git を実行しない)", () => {
    const running = makeRepo("r1", { local: [makeBranch("main")] }, { running: true });

    const submenu = submenuOf(itemsFor("repo", undefined, running), "見出しの色");

    expect(enabled([...submenu.items])).toEqual(["なし", "赤", "オレンジ", "黄", "緑", "青", "紫"]);
  });
});

/** 名前でサブメニューを引く */
function submenuOf(items: MenuItem[], label: string): Extract<MenuItem, { kind: "submenu" }> {
  const found = items.find((item) => item.kind === "submenu" && item.label === label);
  if (found?.kind !== "submenu") throw new Error(`${label} のサブメニューが無い`);
  return found;
}

/** 区切りは `──` として並びに含めて比べる */
function labels(items: MenuItem[]): string[] {
  return items.map((item) => (item.kind === "separator" ? "──" : item.label));
}
