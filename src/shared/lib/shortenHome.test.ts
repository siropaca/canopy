import { describe, expect, it } from "vitest";

import { shortenHome } from "./shortenHome";

describe("shortenHome", () => {
  it("ホームディレクトリを ~ にする", () => {
    expect(shortenHome("/Users/dev/Projects/acme-api")).toBe("~/Projects/acme-api");
  });

  it("ホームの外はそのまま", () => {
    expect(shortenHome("/opt/repos/acme-api")).toBe("/opt/repos/acme-api");
    expect(shortenHome("/Users")).toBe("/Users");
  });

  it("途中に現れる同じ形は縮めない", () => {
    expect(shortenHome("/mnt/Users/dev/x")).toBe("/mnt/Users/dev/x");
  });
});
