import { describe, expect, it } from "vitest";

import { headNote, headSummary } from "./headLabel";

describe("headNote", () => {
  it("通常のブランチには注記を出さない", () => {
    expect(headNote({ kind: "branch", name: "main" })).toBeNull();
  });

  it("detached は参照名を添えて出す", () => {
    expect(headNote({ kind: "detached", name: "v1.0.0" })).toBe("detached: v1.0.0");
  });

  it("リベース中は元のブランチ名を添えて出す", () => {
    expect(headNote({ kind: "rebasing", name: "topic" })).toBe("リベース中: topic");
  });
});

describe("headSummary", () => {
  it("通常のブランチはブランチ名だけ", () => {
    expect(headSummary({ kind: "branch", name: "main" })).toBe("main");
  });

  it("detached は括弧で参照名を出す", () => {
    expect(headSummary({ kind: "detached", name: "v1.0.0" })).toBe("detached (v1.0.0)");
  });

  it("リベース中は括弧で元のブランチ名を出す", () => {
    expect(headSummary({ kind: "rebasing", name: "topic" })).toBe("リベース中 (topic)");
  });
});
