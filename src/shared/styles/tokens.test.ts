import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ROW_HEIGHT } from "./rowHeight";

const MOCK = fileURLToPath(new URL("../../../docs/mock/tree.tmpl.html", import.meta.url));
const TOKENS = fileURLToPath(new URL("./tokens.css", import.meta.url));
const DESIGN_SYSTEM = fileURLToPath(new URL("../../../docs/design-system.md", import.meta.url));

/** トークンの名前。増減したらこの配列も直す */
const TOKEN_NAMES = [
  "--bg",
  "--panel",
  "--head",
  "--border",
  "--border2",
  "--head-line",
  "--overlay-line",
  "--on",
  "--on-border",
  "--fg",
  "--dim",
  "--faint",
  "--disabled",
  "--fg-strong",
  "--fg-mid",
  "--nohit",
  "--hover",
  "--sel",
  "--selfoc",
  "--head-sel",
  "--head-selfoc",
  "--head-nohit",
  "--track",
  "--ahead",
  "--wt",
  "--cur",
  "--dirty",
  "--gone",
  "--folder",
  "--icon",
  "--track-bg",
  "--track-fg",
  "--ahead-bg",
  "--ahead-fg",
  "--dirty-bg",
  "--badge-bg",
  "--badge-fg",
  "--del",
  "--err",
  "--err-line",
  "--out",
  "--out-dim",
  "--graph",
  "--menu-key",
  "--btn",
  "--btn-hover",
  "--btn-border",
  "--btn-face",
  "--accent",
  "--accent-hover",
  "--danger",
  "--danger-hover",
  "--danger-face",
  "--danger-fg",
  "--row",
] as const;

/**
 * `;` で宣言に分ける。丸括弧と引用符の中は区切りとして見ない。
 * `url("data:image/svg+xml;utf8,...")` のような値が途中で切れるのを防ぐ。
 */
export function splitDeclarations(body: string): string[] {
  const declarations: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === ";" && depth === 0) {
      declarations.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  declarations.push(current);
  return declarations;
}

/**
 * CSS の `:root` ブロックにある CSS 変数を名前 -> 値で取り出す。
 * 読めない宣言は捨てずに投げる (docs/testing.md)。
 */
export function readRootVars(source: string, label: string): Record<string, string> {
  // 先にコメントを外す。コメントの中の `}` でブロックが切れるのを防ぐ
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)];
  if (blocks.length !== 1) {
    throw new Error(`${label}: :root ブロックが ${blocks.length} 個ある。1 個だけにする`);
  }

  const vars: Record<string, string> = {};
  for (const declaration of splitDeclarations(blocks[0]?.[1] ?? "")) {
    // 複数行の値を 1 行に畳んでから読む
    const flattened = declaration.replace(/\s+/g, " ").trim();
    if (flattened === "") continue;

    const matched = /^(--[\w-]+)\s*:\s*(\S.*)$/.exec(flattened);
    if (!matched) {
      throw new Error(`${label}: 読めない宣言がある: ${flattened}`);
    }
    const [, name, value] = matched;
    if (!name || !value) {
      throw new Error(`${label}: 名前か値が空: ${flattened}`);
    }
    if (name in vars) {
      throw new Error(`${label}: ${name} が 2 回宣言されている`);
    }
    vars[name] = value;
  }
  return vars;
}

/**
 * design-system.md の表から CSS 変数を取り出す。
 * 色の表は `| \`--bg\` | \`#1e1f22\` | ... |`、寸法の表は `| \`--row: 21px\` | ... |`。
 */
export function readDocumentedVars(markdown: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of markdown.split("\n")) {
    const pair = /^\|\s*`(--[\w-]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (pair?.[1] && pair[2]) {
      vars[pair[1]] = pair[2];
      continue;
    }
    const inline = /^\|\s*`(--[\w-]+)\s*:\s*([^`]+)`\s*\|/.exec(line);
    if (inline?.[1] && inline[2]) {
      vars[inline[1]] = inline[2].trim();
    }
  }
  return vars;
}

describe("readRootVars", () => {
  it("複数行の値も 1 つの宣言として読む", () => {
    const source = `:root{\n  --font:13px/var(--row)\n    -apple-system,\n    sans-serif;\n}`;

    expect(readRootVars(source, "test")).toEqual({
      "--font": "13px/var(--row) -apple-system, sans-serif",
    });
  });

  it("値の中の `;` で宣言を切らない", () => {
    const source = `:root{ --icon:url("data:image/svg+xml;utf8,<svg/>"); --row:21px; }`;

    expect(readRootVars(source, "test")).toEqual({
      "--icon": 'url("data:image/svg+xml;utf8,<svg/>")',
      "--row": "21px",
    });
  });

  it("コメントの中の `}` でブロックを切らない", () => {
    const source = `:root{ /* body{background} で使う */ --bg:#1e1f22; --fg:#dfe1e5; }`;

    expect(readRootVars(source, "test")).toEqual({ "--bg": "#1e1f22", "--fg": "#dfe1e5" });
  });

  it(":root が 2 つあったら投げる", () => {
    const source = `:root{ --a:1px; }\n:root{ --b:2px; }`;

    expect(() => readRootVars(source, "test")).toThrow(/:root ブロックが 2 個/);
  });

  it(":root が無かったら投げる", () => {
    expect(() => readRootVars("body{margin:0}", "test")).toThrow(/:root ブロックが 0 個/);
  });

  it("読めない宣言を黙って捨てない", () => {
    const source = `:root{ --a:1px; color:red; }`;

    expect(() => readRootVars(source, "test")).toThrow(/読めない宣言/);
  });

  it("同じ名前を 2 回宣言していたら投げる", () => {
    const source = `:root{ --a:1px; --a:2px; }`;

    expect(() => readRootVars(source, "test")).toThrow(/2 回宣言/);
  });
});

describe("デザイントークン", () => {
  const mock = readRootVars(readFileSync(MOCK, "utf8"), "モック");
  const implementation = readRootVars(readFileSync(TOKENS, "utf8"), "tokens.css");
  const documented = readDocumentedVars(readFileSync(DESIGN_SYSTEM, "utf8"));

  it("モックの :root と tokens.css が同じ変数と値を持つ", () => {
    expect(implementation).toEqual(mock);
  });

  it("design-system.md の表も同じ変数と値を持つ", () => {
    expect(documented).toEqual(mock);
  });

  it("トークンの名前が想定どおり揃っている", () => {
    expect(Object.keys(mock).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it("仮想化に渡す行高が --row と一致する", () => {
    expect(mock["--row"]).toBe(`${ROW_HEIGHT}px`);
  });
});
