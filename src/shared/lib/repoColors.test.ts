import { describe, expect, it } from "vitest";

import { REPO_COLORS, repoColorLabel } from "./repoColors";

/*
 * 見出しの色の並びとラベル (docs/specs/ui.md の「コンテキストメニュー」)。
 * 色の名前の源は Rust の `RepoColor`。ラベルが全部の色にあることは型が縛る。
 */

describe("見出しの色", () => {
  it("メニューに並べる順は 赤・オレンジ・黄・緑・青・紫", () => {
    expect(REPO_COLORS.map((color) => [color, repoColorLabel(color)])).toEqual([
      ["red", "赤"],
      ["orange", "オレンジ"],
      ["yellow", "黄"],
      ["green", "緑"],
      ["blue", "青"],
      ["purple", "紫"],
    ]);
  });
});
