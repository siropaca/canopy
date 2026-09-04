import { describe, expect, it } from "vitest";

import { type Activity, activityLabel } from "./activity";

/*
 * ステータスバーに出す「いま何をしているか」(docs/adr/0023-progress-in-the-status-bar.md)。
 *
 * **ボタンの無効化だけでは固まって見える。** 場所の決まったところに文言を出す。
 */

const NAMES: Record<string, string> = { r1: "acme-api", r2: "acme-web", r3: "acme-cli" };

function label(
  overrides: {
    running?: ReadonlyMap<string, readonly Activity[]>;
    reading?: ReadonlySet<string>;
    bulk?: { total: number; done: number } | null;
  } = {},
): string | null {
  return activityLabel({
    running: overrides.running ?? new Map(),
    reading: overrides.reading ?? new Set(),
    bulk: overrides.bulk ?? null,
    nameOf: (repoId) => NAMES[repoId],
  });
}

describe("実行中の文言", () => {
  it("何も走っていなければ出さない", () => {
    expect(label()).toBeNull();
  });

  it("書き込みが 1 本なら、リポジトリ名と操作を出す", () => {
    expect(label({ running: new Map([["r1", ["fetch"]]]) })).toBe("acme-api をフェッチ中");
    expect(label({ running: new Map([["r2", ["pull"]]]) })).toBe("acme-web をプル中");
    expect(label({ running: new Map([["r1", ["push"]]]) })).toBe("acme-api をプッシュ中");
    expect(label({ running: new Map([["r1", ["delete"]]]) })).toBe("acme-api を削除中");
    expect(label({ running: new Map([["r1", ["checkout"]]]) })).toBe("acme-api をチェックアウト中");
    expect(label({ running: new Map([["r1", ["rename"]]]) })).toBe("acme-api を名前の変更中");
    expect(label({ running: new Map([["r2", ["checkoutAndPull"]]]) })).toBe(
      "acme-web をチェックアウトとプル中",
    );
  });

  /** どのリポジトリかは行の薄さで見る。フッターは本数だけ出す */
  it("書き込みが 2 本以上なら件数を出す", () => {
    const running = new Map<string, readonly Activity[]>([
      ["r1", ["fetch"]],
      ["r2", ["pull"]],
    ]);

    expect(label({ running })).toBe("2 件を実行中");
  });

  /** 同じリポジトリでフェッチとプルが重なることがある */
  it("1 リポジトリで 2 本走っていても件数を出す", () => {
    expect(label({ running: new Map([["r1", ["fetch", "pull"]]]) })).toBe("2 件を実行中");
  });

  /** 11 件が順に返るので、残りが見えないと終わりが読めない */
  it("一括フェッチは進み具合を出す", () => {
    const running = new Map<string, readonly Activity[]>([
      ["r1", ["fetch"]],
      ["r2", ["fetch"]],
    ]);

    expect(label({ running, bulk: { total: 11, done: 5 } })).toBe("フェッチ 5 / 11");
  });

  it("取り直しが 1 件なら、リポジトリ名を出す", () => {
    expect(label({ reading: new Set(["r3"]) })).toBe("acme-cli を更新中");
  });

  it("取り直しが 2 件以上なら件数を出す", () => {
    expect(label({ reading: new Set(["r1", "r2", "r3"]) })).toBe("3 リポジトリを更新中");
  });

  /**
   * 無効化に対応するのは書き込みだけ。取り直しは `.git` の変化で頻繁に走る
   * (docs/adr/0022-auto-refresh.md)
   */
  it("書き込みと取り直しが重なったら書き込みを出す", () => {
    expect(label({ running: new Map([["r1", ["push"]]]), reading: new Set(["r2", "r3"]) })).toBe(
      "acme-api をプッシュ中",
    );
  });

  /**
   * **一括フェッチが個別の書き込みより先。** 11 件の残りを隠さない。
   * 何も選択していなければ、個別のプッシュ中でもフェッチは押せる
   */
  it("一括フェッチは個別の書き込みより優先する", () => {
    const running = new Map<string, readonly Activity[]>([
      ["r1", ["push"]],
      ["r2", ["fetch"]],
    ]);

    expect(label({ running, bulk: { total: 11, done: 0 } })).toBe("フェッチ 0 / 11");
  });

  /** 一括フェッチの最中に取り直しが走っても、進み具合を隠さない */
  it("一括フェッチは取り直しより優先する", () => {
    expect(
      label({
        running: new Map([["r1", ["fetch"]]]),
        reading: new Set(["r2"]),
        bulk: { total: 4, done: 1 },
      }),
    ).toBe("フェッチ 1 / 4");
  });

  /** リストから消したリポジトリの結果が遅れて届くことがある */
  it("名前が引けないリポジトリは件数の形で出す", () => {
    expect(label({ running: new Map([["r404", ["fetch"]]]) })).toBe("1 件を実行中");
    expect(label({ reading: new Set(["r404"]) })).toBe("1 リポジトリを更新中");
  });

  /** 空の列は走っていない。`endRun` が最後の 1 本を抜いた直後の形 */
  it("空の列は数えない", () => {
    expect(label({ running: new Map([["r1", []]]) })).toBeNull();
  });
});
