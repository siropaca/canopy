import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FILE_LIMIT } from "./changeList";

const CHANGE_RS = fileURLToPath(new URL("../../../src-tauri/src/model/change.rs", import.meta.url));

/** Rust 側の `ChangeList::MAX_ITEMS` を読む */
export function readMaxItems(source: string): number {
  const matched = /pub const MAX_ITEMS: usize = (\d+);/.exec(source);
  if (!matched?.[1]) {
    throw new Error("change.rs に MAX_ITEMS が無い");
  }
  return Number(matched[1]);
}

describe("未コミット一覧の件数", () => {
  it("Rust が切る件数は、画面に出す件数 + 1", () => {
    const maxItems = readMaxItems(readFileSync(CHANGE_RS, "utf8"));

    expect(maxItems).toBe(FILE_LIMIT + 1);
  });
});

describe("readMaxItems", () => {
  it("定数が無ければ投げる", () => {
    expect(() => readMaxItems("pub struct ChangeList {}")).toThrow(/MAX_ITEMS/);
  });
});
