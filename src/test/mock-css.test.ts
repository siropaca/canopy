import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * モックと実装の CSS を突き合わせる。
 *
 * 「モックと 1 つずつ見比べて差分を潰す」を人の目でやると、次に触ったときに戻る。
 * 対応が 1:1 の class について、**見た目に出るプロパティだけ**を機械で比べる。
 *
 * 参照元は `docs/mock/tree.tmpl.html` (`tree.html` は生成物なので読まない)。
 * 意図して変えている差分は `ignore` に理由付きで並べる。**黙って外さない。**
 */

const MOCK = fileURLToPath(new URL("../../docs/mock/tree.tmpl.html", import.meta.url));

/** 比べるプロパティ。位置取り (position / display / flex-direction) は構造の都合で変わる */
const VISUAL = [
  "height",
  "width",
  "max-width",
  "padding",
  "padding-left",
  "padding-right",
  "margin",
  "margin-left",
  "gap",
  "font-size",
  "font-weight",
  "line-height",
  "font-variant-numeric",
  "background",
  "color",
  "border",
  "border-top",
  "border-bottom",
  "border-right",
  "border-radius",
  "box-shadow",
  "min-width",
  "min-height",
  "opacity",
  "align-items",
  "justify-content",
  "text-align",
  "stroke-width",
] as const;

interface Pair {
  /** モック側のセレクタ (完全一致で引く) */
  readonly mock: string;
  /** 実装側の CSS Module のパス (src からの相対) */
  readonly module: string;
  /** 実装側のセレクタ */
  readonly rule: string;
  /** 比べないプロパティと、その理由 */
  readonly ignore?: Readonly<Record<string, string>>;
}

const PAIRS: readonly Pair[] = [
  // ---- ツリー ----
  {
    mock: ".r",
    module: "features/repo-tree/TreeRow.module.css",
    rule: ".row",
    ignore: {
      // モックは `style="--d:N"` で段数を渡すが、素の style 属性は CSP で無効
      // (docs/security.md)。実装は `data-depth` ごとに値を並べている
      "padding-left": "段数の渡し方が違う (モックは style 属性、実装は data-depth)",
    },
  },
  { mock: ".r:hover", module: "features/repo-tree/TreeRow.module.css", rule: ".row:hover" },
  { mock: ".r.sel", module: "features/repo-tree/TreeRow.module.css", rule: ".row.selected" },
  { mock: ".r .nm", module: "features/repo-tree/TreeRow.module.css", rule: ".name" },
  { mock: ".r .sp", module: "features/repo-tree/TreeRow.module.css", rule: ".spring" },
  { mock: ".r.repo", module: "features/repo-tree/TreeRow.module.css", rule: ".row.heading" },
  {
    mock: ".r.repo.sel",
    module: "features/repo-tree/TreeRow.module.css",
    rule: ".row.heading.selected",
  },
  {
    mock: ".r.repo.nohit",
    module: "features/repo-tree/TreeRow.module.css",
    rule: ".row.heading.dimmed",
  },
  {
    mock: ".r.repo.nohit .nm",
    module: "features/repo-tree/TreeRow.module.css",
    rule: ".row.heading.dimmed .name",
  },
  {
    mock: ".r.repo.dragging",
    module: "features/repo-tree/TreeRow.module.css",
    rule: ".row.dragging",
  },
  { mock: ".badge", module: "features/repo-tree/TreeRow.module.css", rule: ".badge" },
  { mock: ".badge svg", module: "features/repo-tree/TreeRow.module.css", rule: ".badge svg" },
  { mock: ".badge.d", module: "features/repo-tree/TreeRow.module.css", rule: ".badgeDirty" },
  { mock: ".badge.b", module: "features/repo-tree/TreeRow.module.css", rule: ".badgeBehind" },
  { mock: ".badge.a", module: "features/repo-tree/TreeRow.module.css", rule: ".badgeAhead" },

  // ---- ブランチ行のインジケーター ----
  { mock: ".dirtyw", module: "features/repo-tree/Indicators.module.css", rule: ".dirty" },
  { mock: ".tkw.dn", module: "features/repo-tree/Indicators.module.css", rule: ".behind" },
  { mock: ".tkw.up", module: "features/repo-tree/Indicators.module.css", rule: ".ahead" },
  { mock: ".gone", module: "features/repo-tree/Indicators.module.css", rule: ".gone" },
  { mock: ".wtm", module: "features/repo-tree/Indicators.module.css", rule: ".worktree" },
  {
    mock: ".wtm .wn",
    module: "features/repo-tree/Indicators.module.css",
    rule: ".worktreeName",
  },

  // ---- 検索 ----
  {
    mock: ".qbar",
    module: "features/repo-tree/SearchBar.module.css",
    rule: ".bar",
    ignore: {
      // モックはツリーごと `overflow:auto` にして sticky で貼り付けているが、
      // 実装はペインを縦の flex にして検索欄を固定枠に置く (仮想化のため)
      "align-items": "実装は flex で組んでいる",
    },
  },
  {
    mock: ".qbar input",
    module: "features/repo-tree/SearchBar.module.css",
    rule: ".input",
    ignore: {
      // モックはアイコンを data URI の背景で描くが、実装はインライン SVG を重ねる
      // (docs/design-system.md)。地の指定がそのぶん違う
      background: "モックは検索アイコンを背景画像で描いている",
    },
  },
  {
    mock: ".qbar input:focus",
    module: "features/repo-tree/SearchBar.module.css",
    rule: ".input:focus",
  },
  {
    mock: ".qbar .clr",
    module: "features/repo-tree/SearchBar.module.css",
    rule: ".clear",
    ignore: {
      // モックは文字の ✕、実装はインライン SVG (docs/design-system.md)
      background: "モックは文字の ✕、実装はインライン SVG",
      border: "モックは文字の ✕、実装はインライン SVG",
      "font-size": "モックは文字の ✕、実装はインライン SVG",
      "line-height": "モックは文字の ✕、実装はインライン SVG",
      height: "実装は上下の余白で高さを決める",
      "align-items": "実装は SVG を中央に置く",
      "justify-content": "実装は SVG を中央に置く",
    },
  },
  {
    mock: ".qbar .clr:hover",
    module: "features/repo-tree/SearchBar.module.css",
    rule: ".clear:hover",
  },

  // ---- サイドバー ----
  { mock: ".strip", module: "features/sidebar/Sidebar.module.css", rule: ".strip" },
  { mock: ".strip .sb", module: "features/sidebar/Sidebar.module.css", rule: ".button" },
  {
    mock: ".strip .sb:hover",
    module: "features/sidebar/Sidebar.module.css",
    rule: ".button:hover",
  },
  { mock: ".strip .sb.on", module: "features/sidebar/Sidebar.module.css", rule: ".button.active" },
  { mock: ".strip .sb svg", module: "features/sidebar/Sidebar.module.css", rule: ".button svg" },
  { mock: ".strip .div", module: "features/sidebar/Sidebar.module.css", rule: ".divider" },
  { mock: ".tip", module: "features/sidebar/Tooltip.module.css", rule: ".tip" },

  // ---- ステータスバー ----
  { mock: ".status", module: "features/status-bar/StatusBar.module.css", rule: ".bar" },

  // ---- 詳細ペイン ----
  // 実装はスクロール領域を分けているので、余白を持つのは中身の側
  { mock: ".detail", module: "features/detail/DetailPane.module.css", rule: ".body" },
  { mock: ".detail h1", module: "features/detail/DetailPane.module.css", rule: ".title" },
  { mock: ".detail .sub", module: "features/detail/DetailPane.module.css", rule: ".subtitle" },
  { mock: ".kv", module: "features/detail/DetailPane.module.css", rule: ".pairs" },
  { mock: ".acts", module: "features/detail/DetailPane.module.css", rule: ".actions" },
  { mock: ".sec2", module: "features/detail/DetailPane.module.css", rule: ".section" },
  { mock: ".files .f", module: "features/detail/DetailPane.module.css", rule: ".files .file" },
  { mock: ".files .st", module: "features/detail/DetailPane.module.css", rule: ".status" },
  { mock: ".files .fp", module: "features/detail/DetailPane.module.css", rule: ".path" },
  { mock: ".files .more", module: "features/detail/DetailPane.module.css", rule: ".more" },
  { mock: ".empty", module: "features/detail/DetailPane.module.css", rule: ".placeholder" },

  // ---- コンソール ----
  { mock: ".console", module: "features/console/ConsolePanel.module.css", rule: ".console" },
  { mock: ".console .ctabs", module: "features/console/ConsolePanel.module.css", rule: ".tabs" },
  { mock: ".console .ctab", module: "features/console/ConsolePanel.module.css", rule: ".tab" },
  {
    mock: ".console .ctab.on",
    module: "features/console/ConsolePanel.module.css",
    rule: ".tab.tabActive",
  },
  { mock: ".console .ctab .dot", module: "features/console/ConsolePanel.module.css", rule: ".dot" },
  { mock: ".console .ro", module: "features/console/ConsolePanel.module.css", rule: ".readOnly" },
  { mock: ".console .ctitle", module: "features/console/ConsolePanel.module.css", rule: ".title" },
  {
    mock: ".console .out",
    module: "features/console/ConsolePanel.module.css",
    rule: ".body",
    // 実装は中に自前スクロールバーの器を入れるので、縮められるようにする
    ignore: { "min-height": "実装は中の器を縮めるために必要" },
  },
  {
    mock: ".console .empty2",
    module: "features/console/ConsolePanel.module.css",
    rule: ".empty",
    // モックは div、実装は p。既定の余白を落とすぶんだけ違う
    ignore: { margin: "実装は p なので既定の余白を落とす" },
  },

  // ---- トースト ----
  { mock: ".toast", module: "features/toast/Toasts.module.css", rule: ".toasts" },
  { mock: ".toast .tst", module: "features/toast/Toasts.module.css", rule: ".toast" },
  { mock: ".toast .tst .ico", module: "features/toast/Toasts.module.css", rule: ".icon" },
  { mock: ".toast .tst .msg", module: "features/toast/Toasts.module.css", rule: ".message" },
  {
    mock: ".toast .tst .lnk",
    module: "features/toast/Toasts.module.css",
    rule: ".link",
    // モックは span、実装は button。ボタンの既定を戻すぶんだけ違う
    ignore: {
      height: "実装は button なので既定を戻す",
      padding: "実装は button なので既定を戻す",
    },
  },

  // ---- メニュー ----
  { mock: ".menu", module: "features/context-menu/ContextMenu.module.css", rule: ".menu" },
  {
    mock: ".menu .mi",
    module: "features/context-menu/ContextMenu.module.css",
    rule: ".item",
    // モックは div、実装は button。ボタンの既定を戻すぶんだけ違う
    ignore: {
      background: "実装は button なので既定を戻す",
      border: "実装は button なので既定を戻す",
      color: "実装は button なので既定を戻す",
      "text-align": "実装は button なので既定を戻す",
      width: "実装は button なので既定を戻す",
    },
  },
  {
    mock: ".menu .mi:hover",
    module: "features/context-menu/ContextMenu.module.css",
    rule: ".item:hover",
  },
  { mock: ".menu .mi.off", module: "features/context-menu/ContextMenu.module.css", rule: ".off" },
  { mock: ".menu .hr", module: "features/context-menu/ContextMenu.module.css", rule: ".separator" },

  // ---- ダイアログ ----
  { mock: ".modal", module: "features/dialog/Dialog.module.css", rule: ".overlay" },
  { mock: ".modal .box", module: "features/dialog/Dialog.module.css", rule: ".box" },
  { mock: ".modal .tbar", module: "features/dialog/Dialog.module.css", rule: ".titleBar" },
  { mock: ".modal .body", module: "features/dialog/Dialog.module.css", rule: ".body" },
  { mock: ".modal .btns", module: "features/dialog/Dialog.module.css", rule: ".buttons" },
  {
    mock: ".modal .btns button",
    module: "features/dialog/Dialog.module.css",
    rule: ".buttons button",
  },

  // ---- スプリッタ ----
  { mock: ".splitter", module: "shared/ui/Splitter.module.css", rule: ".splitter" },
];

type Rules = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** CSS のテキストを「セレクタ -> プロパティ」に開く。@ 規則とネストは扱わない */
export function parseRules(css: string): Rules {
  const rules = new Map<string, Map<string, string>>();
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors === undefined || body === undefined) continue;
    const declarations = new Map<string, string>();
    for (const declaration of body.split(";")) {
      const at = declaration.indexOf(":");
      if (at === -1) continue;
      const property = declaration.slice(0, at).trim();
      // Prettier は `.45` を `0.45` に直す。書き方の違いで落とさない
      const value = normalize(declaration.slice(at + 1));
      if (property !== "") declarations.set(property, value);
    }
    for (const selector of selectors.split(",")) {
      const key = selector.trim().replaceAll(/\s+/g, " ");
      if (key === "" || key.startsWith("@") || key.startsWith(":root")) continue;
      // **セレクタごとに控えを分ける。** 同じ Map を配ると、`.a, .b {}` の
      // あとに書いた `.b {}` が `.a` まで書き換える
      const existing = rules.get(key) ?? new Map<string, string>();
      for (const [property, value] of declarations) existing.set(property, value);
      rules.set(key, existing);
    }
  }
  return rules;
}

/**
 * 値の書き方を揃える。
 *
 * 空白の詰め方、小数の先頭の 0、`rgba()` と `rgb( / )` の書き分けは
 * 見た目に出ない。**Prettier が実装側だけ書き換える**ので、ここで吸収する。
 */
function normalize(value: string): string {
  const spaced = value
    .trim()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/(^|[\s(,])\.(\d)/g, "$10.$2");
  return spaced.replaceAll(
    /rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)/g,
    (_all, red, green, blue, alpha?: string, percent?: string) => {
      if (alpha === undefined) return `rgb(${red} ${green} ${blue})`;
      const value = percent === "%" ? Number(alpha) / 100 : Number(alpha);
      return `rgb(${red} ${green} ${blue} / ${value})`;
    },
  );
}

/** モックの `<style>` の中身 */
function mockCss(): string {
  const source = readFileSync(MOCK, "utf8");
  const block = /<style>([\s\S]*?)<\/style>/.exec(source);
  if (block?.[1] === undefined) throw new Error("モックに <style> が無い");
  return block[1];
}

const mockRules = parseRules(mockCss());
const moduleRules = new Map<string, Rules>();

function rulesOf(module: string): Rules {
  const cached = moduleRules.get(module);
  if (cached !== undefined) return cached;
  const path = fileURLToPath(new URL(`../${module}`, import.meta.url));
  const parsed = parseRules(readFileSync(path, "utf8"));
  moduleRules.set(module, parsed);
  return parsed;
}

/** 見た目に出るプロパティだけを取り出す */
function visual(
  declarations: ReadonlyMap<string, string> | undefined,
  ignore: Readonly<Record<string, string>>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const property of VISUAL) {
    if (property in ignore) continue;
    const value = declarations?.get(property);
    if (value !== undefined) picked[property] = value;
  }
  return picked;
}

describe("モックと実装の CSS", () => {
  it.each(PAIRS.map((pair) => [`${pair.mock} <-> ${pair.rule}`, pair] as const))(
    "%s",
    (_name, pair) => {
      const declared = mockRules.get(pair.mock);
      expect(declared, `モックに ${pair.mock} が無い`).toBeDefined();
      const implemented = rulesOf(pair.module).get(pair.rule);
      expect(implemented, `${pair.module} に ${pair.rule} が無い`).toBeDefined();

      expect(visual(implemented, pair.ignore ?? {})).toEqual(visual(declared, pair.ignore ?? {}));
    },
  );
});

describe("比べる範囲", () => {
  /**
   * **一覧を減らせば差分は消える。** 何を見ているかをテストに書いて、
   * 減らしたら落ちるようにしておく (docs/testing.md)
   */
  it("見た目に出るプロパティを並べてある", () => {
    expect([...VISUAL]).toEqual([
      "height",
      "width",
      "max-width",
      "padding",
      "padding-left",
      "padding-right",
      "margin",
      "margin-left",
      "gap",
      "font-size",
      "font-weight",
      "line-height",
      "font-variant-numeric",
      "background",
      "color",
      "border",
      "border-top",
      "border-bottom",
      "border-right",
      "border-radius",
      "box-shadow",
      "min-width",
      "min-height",
      "opacity",
      "align-items",
      "justify-content",
      "text-align",
      "stroke-width",
    ]);
  });

  it("モックの class を 1 つずつ対応させてある", () => {
    // 減らせば差分は出なくなる。組数を固定して、外したら落とす
    expect(PAIRS).toHaveLength(71);
  });
});

describe("parseRules", () => {
  it("セレクタごとにプロパティを開く", () => {
    expect(parseRules(".a{color:red;gap:4px}").get(".a")).toEqual(
      new Map([
        ["color", "red"],
        ["gap", "4px"],
      ]),
    );
  });

  it("カンマ区切りのセレクタは同じ内容を配る", () => {
    const rules = parseRules(".a,.b{color:red}");

    expect(rules.get(".a")?.get("color")).toBe("red");
    expect(rules.get(".b")?.get("color")).toBe("red");
  });

  it("コメントは読まない", () => {
    expect(parseRules("/* .a{color:red} */ .b{color:blue}").get(".a")).toBeUndefined();
  });

  it("同じセレクタが 2 度出たら後から足す", () => {
    const rules = parseRules(".a{color:red}.a{gap:4px}");

    expect(rules.get(".a")?.get("color")).toBe("red");
    expect(rules.get(".a")?.get("gap")).toBe("4px");
  });

  it("空白の入れ方は揃える", () => {
    expect(parseRules(".a  .b{padding:0   4px}").get(".a .b")?.get("padding")).toBe("0 4px");
  });

  it("小数の先頭の 0 は書き方の違いとして揃える", () => {
    expect(parseRules(".a{opacity:.45}").get(".a")?.get("opacity")).toBe("0.45");
  });

  /** Prettier が実装側だけ `rgb( / %)` に書き換えるので、同じ色として扱う */
  it("rgba と rgb( / ) を同じ形にする", () => {
    expect(parseRules(".a{background:rgba(0,0,0,.4)}").get(".a")?.get("background")).toBe(
      "rgb(0 0 0 / 0.4)",
    );
    expect(parseRules(".a{background:rgb(0 0 0 / 40%)}").get(".a")?.get("background")).toBe(
      "rgb(0 0 0 / 0.4)",
    );
  });

  /** `.a, .b {}` のあとの `.b {}` が `.a` まで書き換えてはいけない */
  it("カンマ区切りの控えを共有しない", () => {
    const rules = parseRules(".a,.b{gap:3px}.b{color:blue}");

    expect(rules.get(".a")?.get("color")).toBeUndefined();
    expect(rules.get(".b")?.get("color")).toBe("blue");
  });
});
