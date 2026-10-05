import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REPO_COLORS } from "@/shared/lib/repoColors";

/*
 * 見出しの色と、選択・薄い表示の優先順位 (docs/adr/0024-repo-heading-color.md)。
 *
 * **選択と薄い表示は色の上に乗る。** セレクタの詳細度が同じなので、勝ち負けは
 * ファイルの中の並び順で決まる (docs/pitfalls.md の「CSS の特異性が同じなら
 * 後に書いた方が勝つ」)。jsdom は CSS Modules の値を計算しないので、並び順を直接見る。
 */

const CSS = fileURLToPath(new URL("./TreeRow.module.css", import.meta.url));
/**
 * そのセレクタのルールが始まる位置。無ければ落とす。
 *
 * **行頭で一致させる。** `.row.heading.selected {` は、後ろにある
 * `[data-tree-pane]:focus-within .row.heading.selected {` にも部分一致する。
 */
function positionOf(css: string, selector: string): number {
  const at = css.indexOf(`\n${selector} {`);
  if (at === -1) throw new Error(`${selector} が無い`);
  return at + 1;
}

describe("見出しの色の CSS", () => {
  const css = readFileSync(CSS, "utf8");

  it.each(REPO_COLORS)("%s はトークンで塗る", (color) => {
    const at = positionOf(css, `.row.heading[data-color="${color}"]`);
    const body = css.slice(at, css.indexOf("}", at));

    expect(body).toContain(`background: var(--head-${color});`);
  });

  it.each(REPO_COLORS)("%s は選択と薄い表示より前に書いてある", (color) => {
    const colored = positionOf(css, `.row.heading[data-color="${color}"]`);

    expect(colored).toBeLessThan(positionOf(css, ".row.heading.selected"));
    expect(colored).toBeLessThan(positionOf(css, ".row.heading.dimmed"));
  });

  /** 実行中は文字だけ薄くする。背景を塗り替えると見出しの色が消える */
  it("実行中の見出しは背景を塗り替えない", () => {
    const at = positionOf(css, ".row.heading.busy");
    const body = css.slice(at, css.indexOf("}", at));

    expect(body).toContain("color: var(--nohit);");
    expect(body).not.toContain("background");
  });
});
