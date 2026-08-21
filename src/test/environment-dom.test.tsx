import { describe, expect, it } from "vitest";

/** *.test.tsx は jsdom で走る (vite.config.ts の test.projects)。 */
describe("テストの環境", () => {
  it("*.test.tsx には DOM がある", () => {
    expect(typeof document).toBe("object");
  });
});
