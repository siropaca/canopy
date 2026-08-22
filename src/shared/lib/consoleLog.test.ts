import { describe, expect, it } from "vitest";

import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { CommandStep } from "@/ipc/generated/CommandStep";

import { consoleBlocks, consoleLines, formatTime } from "./consoleLog";

/*
 * コンソールに出す行の組み立て。
 *
 * **1 段 (`CommandStep`) が 1 ブロック** (docs/adr/0018-command-result-steps.md)。
 * 行の形式と色分けは docs/specs/ui.md の「コンソール」。
 */

const AT = new Date(2026, 7, 21, 2, 4, 17, 543);
const CWD = "/Users/dev/Projects/acme/acme-api";

function step(overrides: Partial<CommandStep> = {}): CommandStep {
  return {
    dir: CWD,
    command: "git fetch --prune",
    code: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function ran(steps: CommandStep[], overrides: Partial<CommandResult> = {}): CommandResult {
  return { kind: "ran", ok: true, steps, message: null, ...overrides };
}

describe("コンソールのブロック", () => {
  it("段ごとに 1 ブロックになる", () => {
    const result = ran([
      step({ command: "git switch topic" }),
      step({ command: "git pull --rebase" }),
    ]);

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.lines[0]?.text).toContain("git switch topic");
    expect(blocks[1]?.lines[0]?.text).toContain("git pull --rebase");
  });

  it("コマンド行は 時刻: [作業ディレクトリ] コマンド の形で出す", () => {
    const result = ran([step({ command: "git pull --rebase" })]);

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines[0]).toEqual({
      kind: "command",
      text: `02:04:17.543: [${CWD}] git pull --rebase`,
    });
  });

  it("失敗した段の stderr は赤い行にする", () => {
    const result = ran(
      [
        step({
          command: "git pull --rebase",
          code: 1,
          stderr: "error: cannot pull with rebase: You have unstaged changes.",
        }),
      ],
      { ok: false },
    );

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines[1]).toEqual({
      kind: "error",
      text: "error: cannot pull with rebase: You have unstaged changes.",
    });
  });

  it("成功した段の stderr は通常の出力として出す", () => {
    // git は進捗を stderr に書く。成功した段まで赤くすると、フェッチが毎回失敗して見える
    const result = ran([step({ stderr: "From github.com:acme/acme-api\n * [new branch] topic" })]);

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines.map((line) => line.kind)).toEqual(["command", "output", "output"]);
  });

  it("出力は 1 行ずつに分けて、末尾の改行で空行を作らない", () => {
    const result = ran([step({ stdout: "Already up to date.\n" })]);

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines).toHaveLength(2);
    expect(blocks[0]?.lines[1]).toEqual({ kind: "output", text: "Already up to date." });
  });

  it("打ち切りで出力が空でも文言はコンソールに残す", () => {
    // 打ち切ると stdout / stderr が空になる (docs/specs/git-operations.md)
    const result = ran([step({ command: "git fetch --prune", code: null })], {
      ok: false,
      message: "リモートの応答がありません (30 秒で打ち切りました)",
    });

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines[1]).toEqual({
      kind: "error",
      text: "リモートの応答がありません (30 秒で打ち切りました)",
    });
  });

  it("成功しても伝えるべき文言は最後のブロックに残す", () => {
    const result = ran([step({ command: "git switch topic" }), step({ command: "git status" })], {
      message: "既存のローカルブランチに切り替えました",
    });

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines).toHaveLength(1);
    expect(blocks[1]?.lines.at(-1)).toEqual({
      kind: "output",
      text: "既存のローカルブランチに切り替えました",
    });
  });

  it("git を実行していない結果はブロックを作らない", () => {
    // 省略とコピーは段を持たない (docs/adr/0018-command-result-steps.md)
    const skipped: CommandResult = {
      kind: "skipped",
      ok: false,
      steps: [],
      message: "同じ操作を実行中です",
    };
    const direct: CommandResult = {
      kind: "direct",
      ok: false,
      steps: [],
      message: "コピーできませんでした",
    };

    expect(consoleBlocks(skipped, { at: AT })).toEqual([]);
    expect(consoleBlocks(direct, { at: AT })).toEqual([]);
  });
});

describe("作業ディレクトリ", () => {
  /** 別のワークツリーにあるブランチのプルは、そのワークツリーで走る */
  it("段が持っているディレクトリを出す (登録したパスとは限らない)", () => {
    const result = ran([
      step({ dir: "/repos/acme-api", command: "git switch topic" }),
      step({ dir: "/Users/dev/worktrees/feature-x", command: "git pull --rebase" }),
    ]);

    const blocks = consoleBlocks(result, { at: AT });

    expect(blocks[0]?.lines[0]?.text).toContain("[/repos/acme-api]");
    expect(blocks[1]?.lines[0]?.text).toContain("[/Users/dev/worktrees/feature-x]");
  });
});

describe("時刻の書式", () => {
  it("ミリ秒まで 0 詰めで出す", () => {
    expect(formatTime(new Date(2026, 7, 21, 2, 4, 17, 543))).toBe("02:04:17.543");
    expect(formatTime(new Date(2026, 7, 21, 23, 59, 9, 7))).toBe("23:59:09.007");
  });
});

describe("行への展開", () => {
  it("ブロックをまたいで 1 本の行の列にする", () => {
    const lines = consoleLines([
      { id: "b1", lines: [{ kind: "command", text: "git switch topic" }] },
      {
        id: "b2",
        lines: [
          { kind: "command", text: "git pull --rebase" },
          { kind: "error", text: "error: cannot pull" },
        ],
      },
    ]);

    expect(lines.map((line) => line.text)).toEqual([
      "git switch topic",
      "git pull --rebase",
      "error: cannot pull",
    ]);
  });

  it("鍵はブロックと行番号から作る。積み増しても変わらない", () => {
    const first = consoleLines([{ id: "b1", lines: [{ kind: "command", text: "a" }] }]);
    const grown = consoleLines([
      { id: "b1", lines: [{ kind: "command", text: "a" }] },
      { id: "b2", lines: [{ kind: "command", text: "b" }] },
    ]);

    expect(grown[0]?.key).toBe(first[0]?.key);
    expect(new Set(grown.map((line) => line.key)).size).toBe(2);
  });

  it("何も無ければ空", () => {
    expect(consoleLines(undefined)).toEqual([]);
    expect(consoleLines([])).toEqual([]);
  });
});
