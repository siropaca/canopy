import { describe, expect, it } from "vitest";

import { messageOf } from "./errorMessage";

describe("messageOf", () => {
  it("文字列はそのまま", () => {
    expect(messageOf("ディレクトリが見つかりません")).toBe("ディレクトリが見つかりません");
  });

  it("Error は message を使う", () => {
    expect(messageOf(new Error("壊れた"))).toBe("壊れた");
  });

  it("知らない形も捨てずに出す", () => {
    expect(messageOf({ code: 2 })).toBe('不明なエラー: {"code":2}');
  });

  it("null と undefined も文字にする", () => {
    expect(messageOf(null)).toBe("不明なエラー: null");
    expect(messageOf(undefined)).toBe("不明なエラー: undefined");
  });
});
