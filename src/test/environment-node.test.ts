import { describe, expect, it } from "vitest";

/**
 * *.test.ts は node で走る。DOM を触るテストを拡張子だけで分けている
 * (vite.config.ts の test.projects)。
 */
describe("テストの環境", () => {
  it("*.test.ts に DOM は無い", () => {
    expect(typeof document).toBe("undefined");
  });
});
