import type { Head } from "@/ipc/generated/Head";

/*
 * HEAD の状態を出す文言。
 *
 * ツリーの見出しと詳細ペインの「現在」で形が違う (docs/specs/ui.md の
 * 「detached HEAD」「リベース中」)。**両方をここに置く。** 片方だけ直すと、
 * 同じ状態が 2 通りの言い方で出る。
 */

/** リポジトリ見出しの右に出す注記。通常のブランチなら出さない */
export function headNote(head: Head): string | null {
  switch (head.kind) {
    case "branch":
      return null;
    case "detached":
      return `detached: ${head.name}`;
    case "rebasing":
      // rebase を中断する手段はこのツールに無い。ターミナルで
      // `git rebase --abort` する前提で、状態だけ見えるようにする
      return `リベース中: ${head.name}`;
  }
}

/** 詳細ペインの「現在」に出す文字列 */
export function headSummary(head: Head): string {
  switch (head.kind) {
    case "branch":
      return head.name;
    case "detached":
      return `detached (${head.name})`;
    case "rebasing":
      return `リベース中 (${head.name})`;
  }
}
