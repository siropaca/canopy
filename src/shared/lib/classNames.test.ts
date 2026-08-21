import { describe, expect, it } from "vitest";

import { classNames } from "./classNames";

describe("classNames", () => {
  it("空白でつなぐ", () => {
    expect(classNames("row", "selected")).toBe("row selected");
  });

  it("undefined と false と空文字を落とす", () => {
    expect(classNames("row", undefined, false, "", null, "dim")).toBe("row dim");
  });

  it("何も無ければ空文字", () => {
    expect(classNames(undefined, false)).toBe("");
  });
});
