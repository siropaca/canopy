import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * CSS Modules のクラス名を検査する。
 *
 * vite/client の型定義は `*.module.css` を `{ readonly [key: string]: string }` として
 * 宣言しているので、`styles.typoo` は型検査も lint も通り、実行時に className が
 * undefined になって無スタイルの要素が出るだけになる (docs/pitfalls.md)。
 * 型で縛る道具は入れず、参照と定義の突き合わせをここで行う。
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** 走査した結果。1 ファイル分 */
interface Usage {
  readonly file: string;
  readonly cssFile: string;
  readonly used: readonly string[];
  readonly dynamic: readonly string[];
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      // テスト自身は対象外。例に書いた `styles.foo` を参照として拾ってしまう
      found.push(path);
    }
  }
  return found.sort();
}

/** CSS からクラス名を取り出す。`.row:hover` や `.row.sel` も拾う */
export function readClassNames(css: string): Set<string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set<string>();
  for (const [, name] of withoutComments.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    if (name) names.add(name);
  }
  return names;
}

/**
 * `import styles from "./X.module.css"` を持つファイルから、
 * `styles.foo` / `styles["foo"]` の参照と、静的に読めない参照を取り出す。
 */
export function readStyleUsage(source: string): {
  specifier: string | null;
  used: string[];
  dynamic: string[];
} {
  const imported = /import\s+(\w+)\s+from\s+"([^"]+\.module\.css)"/.exec(source);
  if (!imported?.[1] || !imported[2]) return { specifier: null, used: [], dynamic: [] };
  const [, binding, specifier] = imported;

  const used: string[] = [];
  const dynamic: string[] = [];
  for (const [, dotted, quoted, rest] of source.matchAll(
    new RegExp(`\\b${binding}(?:\\.(\\w+)|\\["([^"]+)"\\]|\\[([^\\]]+)\\])`, "g"),
  )) {
    if (dotted !== undefined) used.push(dotted);
    else if (quoted !== undefined) used.push(quoted);
    else if (rest !== undefined) dynamic.push(rest);
  }
  return { specifier, used, dynamic };
}

function collect(): Usage[] {
  const usages: Usage[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const { specifier, used, dynamic } = readStyleUsage(source);
    if (!specifier) continue;
    usages.push({
      file,
      cssFile: resolve(dirname(file), specifier),
      used,
      dynamic,
    });
  }
  return usages;
}

describe("readStyleUsage", () => {
  it('`styles.foo` と `styles["foo"]` を拾う', () => {
    const source = `import styles from "./A.module.css";\nconst a = styles.row;\nconst b = styles["sel"];`;

    expect(readStyleUsage(source)).toEqual({
      specifier: "./A.module.css",
      used: ["row", "sel"],
      dynamic: [],
    });
  });

  it("静的に読めない参照を dynamic として残す", () => {
    const source = `import styles from "./A.module.css";\nconst a = styles[kind];`;

    expect(readStyleUsage(source).dynamic).toEqual(["kind"]);
  });

  it("CSS Modules を import していないファイルは対象外", () => {
    expect(readStyleUsage(`import { useState } from "react";`).specifier).toBeNull();
  });
});

describe("readClassNames", () => {
  it("複合セレクタと擬似クラスからクラス名を取り出す", () => {
    const css = `.row.sel:hover .name { color: red }\n.row[data-depth="2"] { padding: 0 }`;

    expect([...readClassNames(css)].sort()).toEqual(["name", "row", "sel"]);
  });

  it("小数はクラス名として読まない", () => {
    expect([...readClassNames(`.a { opacity: 0.5; margin: .5px }`)]).toEqual(["a"]);
  });

  it("コメントの中は読まない", () => {
    expect([...readClassNames(`/* .old は消した */ .new { color: red }`)]).toEqual(["new"]);
  });
});

describe("CSS Modules", () => {
  const usages = collect();

  it("走査対象が 1 件以上ある", () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it.each(usages.map((u) => [u.file.slice(SRC.length), u] as const))(
    "%s の styles 参照がすべて CSS に定義されている",
    (_name, usage) => {
      const defined = readClassNames(readFileSync(usage.cssFile, "utf8"));

      expect([...new Set(usage.used)].filter((name) => !defined.has(name))).toEqual([]);
    },
  );

  it.each(usages.map((u) => [u.file.slice(SRC.length), u] as const))(
    "%s の CSS に使っていないクラスが無い",
    (_name, usage) => {
      const defined = readClassNames(readFileSync(usage.cssFile, "utf8"));

      expect([...defined].filter((name) => !usage.used.includes(name))).toEqual([]);
    },
  );

  it.each(usages.map((u) => [u.file.slice(SRC.length), u] as const))(
    "%s は styles を動的に引いていない",
    (_name, usage) => {
      // 動的に引くと参照を機械で追えない。分岐は文字列リテラルで書く
      expect(usage.dynamic).toEqual([]);
    },
  );
});
