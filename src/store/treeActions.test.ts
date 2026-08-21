import { beforeEach, describe, expect, it } from "vitest";

import { makeBranch, makeRef, makeRepo } from "@/test/factories";

import { collapseAll, expandAll, expandLocalOnly } from "./treeActions";
import { useRepoStore } from "./useRepoStore";
import { useUiStore } from "./useUiStore";

describe("ツリーの展開", () => {
  beforeEach(() => {
    const repo = makeRepo("r1", {
      local: [makeBranch("feature/a"), makeBranch("main")],
      remote: [makeRef("origin/main")],
      tags: [makeRef("v1.0.0")],
    });
    useRepoStore.setState({
      byId: new Map([["r1", repo]]),
      order: ["r1"],
      loaded: true,
      loadError: null,
    });
    useUiStore.getState().setExpanded([]);
  });

  it("すべて展開はリモートとタグの中まで開く", () => {
    expandAll();

    expect([...useUiStore.getState().expanded].sort()).toEqual([
      "r1|local|",
      "r1|local|feature",
      "r1|remote|",
      "r1|remote|origin",
      "r1|repo|",
      "r1|tag|",
    ]);
  });

  it("ローカルのみの展開はリモートとタグを開かない", () => {
    expandAll();

    expandLocalOnly();

    expect([...useUiStore.getState().expanded].sort()).toEqual([
      "r1|local|",
      "r1|local|feature",
      "r1|repo|",
    ]);
  });

  it("すべて折りたたむは鍵を空にする", () => {
    expandAll();

    collapseAll();

    expect(useUiStore.getState().expanded.size).toBe(0);
  });
});
