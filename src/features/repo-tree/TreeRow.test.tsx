import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RowNode } from "@/ipc/types";
import { flatten } from "@/shared/lib/flattenTree";
import { allKeysOf } from "@/shared/lib/treeKeys";
import {
  makeBranch,
  makeChanges,
  makeErrorRepo,
  makeLoadingRepo,
  makeRef,
  makeRepo,
  makeWorktree,
} from "@/test/factories";

import { TreeRow } from "./TreeRow";
import styles from "./TreeRow.module.css";

/** 全部開いた状態の行を作る */
function rowsOf(snapshot: Partial<RepoSnapshot>): RowNode[] {
  const repo = makeRepo("r1", snapshot);
  return flatten([repo], {
    expanded: new Set(allKeysOf([repo], ["local", "remote", "tag"])),
    query: "",
    groupDirectories: true,
    localOnly: false,
  });
}

function renderRow(row: RowNode, overrides: Partial<Parameters<typeof TreeRow>[0]> = {}) {
  const props = {
    row,
    selected: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    ...overrides,
  };
  const rendered = render(<TreeRow {...props} />);
  const element = rendered.container.firstElementChild;
  if (element === null) throw new Error("行が描かれていない");
  return { ...props, element };
}

function findRow(rows: RowNode[], predicate: (row: RowNode) => boolean): RowNode {
  const row = rows.find(predicate);
  if (row === undefined) throw new Error("行が見つからない");
  return row;
}

describe("ブランチ行", () => {
  it("インジケーターを仕様の順に出す (未コミット -> behind -> ahead -> gone -> ワークツリー)", () => {
    const rows = rowsOf({
      local: [
        makeBranch("dev/side", {
          behind: 3,
          ahead: 1,
          upstream_gone: true,
          worktree_path: "/worktrees/side",
        }),
      ],
      worktrees: [
        makeWorktree("dev/side", "/worktrees/side", { changes: makeChanges(["a.ts", "b.ts"]) }),
      ],
    });
    const row = findRow(rows, (candidate) => candidate.kind === "branch");

    const { element } = renderRow(row);

    // 矢印は SVG なので文字には出ない。順序はホバーの文言で確かめる
    expect(
      [...element.querySelectorAll("[title]")].map((node) => node.getAttribute("title")),
    ).toEqual([
      "dev/side",
      "未コミット 2 ファイル",
      "3 コミット遅れている",
      "1 コミット進んでいる",
      "追跡ブランチが消えている",
      "ワークツリー side にチェックアウト済み",
    ]);
    expect(element.textContent).toBe("side●231goneside");
  });

  it("0 のインジケーターは出さない", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const row = findRow(rows, (candidate) => candidate.kind === "branch");

    const { element } = renderRow(row);

    expect(element.textContent).toBe("main");
  });

  it("未コミットの数はホバーで読める", () => {
    const rows = rowsOf({
      local: [makeBranch("main", { is_current: true })],
      changes: makeChanges(["a.ts"]),
    });
    const row = findRow(rows, (candidate) => candidate.kind === "branch");

    renderRow(row);

    expect(screen.getByTitle("未コミット 1 ファイル").textContent).toBe("●1");
  });

  it("長い名前はホバーで完全な名前を出す", () => {
    const rows = rowsOf({ local: [makeBranch("feature/rec-482-repeat-offer")] });
    const row = findRow(rows, (candidate) => candidate.kind === "branch");

    renderRow(row);

    expect(screen.getByTitle("feature/rec-482-repeat-offer").textContent).toBe(
      "rec-482-repeat-offer",
    );
  });

  it("深さを data-depth に出す (インデントは CSS 側)", () => {
    const rows = rowsOf({ local: [makeBranch("feature/a")] });

    expect(renderRow(rows[0]!).element.getAttribute("data-depth")).toBe("0");
    expect(renderRow(rows[1]!).element.getAttribute("data-depth")).toBe("1");
    expect(renderRow(rows[2]!).element.getAttribute("data-depth")).toBe("2");
    expect(renderRow(rows[3]!).element.getAttribute("data-depth")).toBe("3");
  });
});

describe("リポジトリ見出し", () => {
  it("読み込み中は右に薄く出す", () => {
    const rows = flatten([makeLoadingRepo("r1", "acme-api")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    const { element } = renderRow(rows[0]!);

    expect(element.textContent).toBe("acme-api読み込み中");
  });

  it("エラーは理由を出す。行は消さない", () => {
    const rows = flatten([makeErrorRepo("r1", "ディレクトリが見つかりません", "acme-api")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    const { element } = renderRow(rows[0]!);

    expect(element.textContent).toBe("acme-apiディレクトリが見つかりません");
  });

  it("サマリのバッジは折りたたんでいるときだけ出す", () => {
    const repo = makeRepo("r1", {
      local: [makeBranch("main", { behind: 9 }), makeBranch("develop", { ahead: 2 })],
      changes: makeChanges(["a.ts"]),
    });
    const collapsed = flatten([repo], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });
    const expanded = flatten([repo], {
      expanded: new Set(["r1|repo|"]),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    // ●1 / ↙9 / ↗2 の順。矢印は SVG なので数字だけが文字になる
    expect(renderRow(collapsed[0]!).element.textContent).toBe("acme-api●192");
    expect(renderRow(expanded[0]!).element.textContent).toBe("acme-api");
  });

  it("detached HEAD は参照名を見出しに出す", () => {
    const repo = makeRepo("r1", { head: { kind: "detached", name: "v1.0.0" } });
    const rows = flatten([repo], {
      expanded: new Set(["r1|repo|"]),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    expect(renderRow(rows[0]!).element.textContent).toBe("acme-apidetached: v1.0.0");
  });
});

describe("見出しを薄くする / 選択を塗る", () => {
  it("エラーのリポジトリは見出しを薄くする (docs/specs/ui.md)", () => {
    const rows = flatten([makeErrorRepo("r1", "ディレクトリが見つかりません", "acme-api")], {
      expanded: new Set<string>(),
      query: "",
      groupDirectories: true,
      localOnly: false,
    });

    const { element } = renderRow(rows[0]!);

    expect(element.className).toContain(styles.dimmed);
  });

  it("検索でヒットが無いリポジトリも薄くする", () => {
    const repo = makeRepo("r1", { local: [makeBranch("main")] });
    const rows = flatten([repo], {
      expanded: new Set<string>(),
      query: "みつからない語",
      groupDirectories: true,
      localOnly: false,
    });

    const { element } = renderRow(rows[0]!);

    expect(element.className).toContain(styles.dimmed);
  });

  it("ヒットがあるリポジトリは薄くしない", () => {
    const repo = makeRepo("r1", { local: [makeBranch("main")] });
    const rows = flatten([repo], {
      expanded: new Set<string>(),
      query: "main",
      groupDirectories: true,
      localOnly: false,
    });

    const { element } = renderRow(rows[0]!);

    expect(element.className).not.toContain(styles.dimmed);
  });

  it("選択している行に選択の class が付く", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const row = findRow(rows, (candidate) => candidate.kind === "branch");

    const selected = renderRow(row, { selected: true }).element.className;
    const plain = renderRow(row).element.className;

    expect(selected).toContain(styles.selected);
    expect(plain).not.toContain(styles.selected);
  });
});

describe("括りとタグの行", () => {
  it("括りに件数を出さない", () => {
    const rows = rowsOf({ local: [makeBranch("main"), makeBranch("develop")] });
    const section = findRow(rows, (candidate) => candidate.kind === "section");

    expect(renderRow(section).element.textContent).toBe("ローカル");
  });

  it("タグの行はタグ名だけ", () => {
    const rows = rowsOf({ tags: [makeRef("v1.0.0")] });
    const tag = findRow(rows, (candidate) => candidate.kind === "tag");

    expect(renderRow(tag).element.textContent).toBe("v1.0.0");
  });
});

describe("行の操作", () => {
  it("クリックで選択する", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const branch = findRow(rows, (candidate) => candidate.kind === "branch");
    const { element, onSelect } = renderRow(branch);

    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith(branch.key);
  });

  it("シェブロンのクリックで開閉する。v1 で唯一のシングルクリック", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const section = findRow(rows, (candidate) => candidate.kind === "section");
    const { element, onToggle, onSelect } = renderRow(section);
    const chevron = element.querySelector("svg")?.parentElement;

    chevron?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));

    expect(onToggle).toHaveBeenCalledWith(section.key);
    // 選択も動く
    expect(onSelect).toHaveBeenCalledWith(section.key);
  });

  it("ダブルクリックで開閉する (折りたためる行)", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const section = findRow(rows, (candidate) => candidate.kind === "section");
    const { element, onToggle } = renderRow(section);

    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ブランチのダブルクリックでは開閉しない (チェックアウトはフェーズ 2)", () => {
    const rows = rowsOf({ local: [makeBranch("main")] });
    const branch = findRow(rows, (candidate) => candidate.kind === "branch");
    const { element, onToggle } = renderRow(branch);

    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(onToggle).not.toHaveBeenCalled();
  });
});
