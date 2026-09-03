import type { CommandResult } from "@/ipc/generated/CommandResult";
import type { CommandStep } from "@/ipc/generated/CommandStep";

/*
 * コンソールに出す行の組み立て。
 *
 * **1 段 (`CommandStep`) が 1 ブロック** (docs/adr/0018-command-result-steps.md)。
 * 段の数で終わり方を判定しない。省略・コピー・アプリ側の異常が全部 0 段になる。
 *
 * 行の形式と色分けは docs/specs/ui.md の「コンソール」。
 */

export type ConsoleLineKind = "command" | "output" | "error";

export interface ConsoleLine {
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

/** 1 段ぶんの出力。コマンド行 + その出力 */
export interface ConsoleBlock {
  readonly lines: readonly ConsoleLine[];
}

/** 積み上げたブロック。鍵はストアが振る (`store/useConsoleStore.ts`) */
export interface IdentifiedBlock extends ConsoleBlock {
  readonly id: string;
  /** 省略したブロックの件数。**省略の印そのものにだけ入る** */
  readonly elided?: number;
}

/**
 * タブ 1 枚が持てるブロック数。
 *
 * 1 操作が 1〜2 ブロックなので、500 は 1 日使い続けても届かない量
 * (docs/specs/ui.md の「コンソール」)。
 */
export const CONSOLE_BLOCK_LIMIT = 500;

/** 省略の印の鍵。タブの中で 1 つだけ */
export const ELIDED_ID = "elided";

/**
 * 上限を超えた古いブロックを落とす。
 *
 * **黙って捨てない。** 落とした件数を先頭の 1 ブロックにまとめて出す。
 * 印そのものも 1 枠に数えるので、返る長さは必ず `limit` 以下。
 */
export function capBlocks(
  blocks: readonly IdentifiedBlock[],
  limit: number = CONSOLE_BLOCK_LIMIT,
): IdentifiedBlock[] {
  if (blocks.length <= limit) return [...blocks];
  const alreadyElided = blocks.find((block) => block.id === ELIDED_ID)?.elided ?? 0;
  const output = blocks.filter((block) => block.id !== ELIDED_ID);
  // **印の 1 枠を引いた残りを保つ。** `slice(-0)` は `slice(0)` と同じで全件になるので、
  // 上限 1 以下のときは 1 件も残さない
  const room = Math.max(0, limit - 1);
  const kept = room === 0 ? [] : output.slice(-room);
  return [elidedBlock(alreadyElided + output.length - kept.length), ...kept];
}

/** 省略した件数を伝える 1 ブロック */
function elidedBlock(count: number): IdentifiedBlock {
  return {
    id: ELIDED_ID,
    elided: count,
    lines: [{ kind: "output", text: `古い出力 ${count} 件を省略しました` }],
  };
}

/** 仮想リストに渡す 1 行。鍵はブロックの id と行番号から作る */
export interface ConsoleOutputLine extends ConsoleLine {
  readonly key: string;
}

/**
 * ブロックを行に開く。
 *
 * 仮想スクロールは行の単位で描くので、ここで平坦にする。
 * 鍵は積み増しても変わらない (ブロックの id は使い回さない)。
 */
export function consoleLines(blocks: readonly IdentifiedBlock[] | undefined): ConsoleOutputLine[] {
  if (blocks === undefined) return [];
  return blocks.flatMap((block) =>
    block.lines.map((line, index) => ({ ...line, key: `${block.id}:${index}` })),
  );
}

export interface ConsoleContext {
  /** コマンド行に出す時刻 */
  readonly at: Date;
}

/**
 * 結果をコンソールのブロックにする。
 *
 * git を実行していない結果 (`skipped` / `direct`) は段を持たないので空になる。
 * その場合の伝達手段はトーストだけ (docs/specs/ui.md の「トースト」)。
 */
export function consoleBlocks(result: CommandResult, context: ConsoleContext): ConsoleBlock[] {
  const blocks = result.steps.map((step) => ({ lines: linesOf(step, context) }));
  // **打ち切ると stdout / stderr が空になる** (docs/specs/git-operations.md)。
  // 文言まで落とすと、コマンド行だけが残って理由が消える
  const last = blocks.at(-1);
  if (last !== undefined && result.message !== null) {
    blocks[blocks.length - 1] = {
      lines: [...last.lines, { kind: result.ok ? "output" : "error", text: result.message }],
    };
  }
  return blocks;
}

function linesOf(step: CommandStep, context: ConsoleContext): ConsoleLine[] {
  // **作業ディレクトリは段が持っているものを出す。** 登録したパスとは限らない
  // (別のワークツリーにあるブランチのプルはそのワークツリーで走る)
  const lines: ConsoleLine[] = [
    { kind: "command", text: `${formatTime(context.at)}: [${step.dir}] ${step.command}` },
  ];
  for (const text of split(step.stdout)) {
    lines.push({ kind: "output", text });
  }
  // **成功した段の stderr は赤くしない。** git は進捗を stderr に書くので、
  // 一律で赤にするとフェッチが毎回失敗したように見える
  const failed = step.code !== 0;
  for (const text of split(step.stderr)) {
    lines.push({ kind: failed ? "error" : "output", text });
  }
  return lines;
}

/** 出力を行に分ける。末尾の改行で空行を作らない */
function split(output: string): string[] {
  if (output === "") return [];
  return output.replace(/\n$/, "").split("\n");
}

/** `02:04:17.543` の形。桁は 0 で詰める */
export function formatTime(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}
