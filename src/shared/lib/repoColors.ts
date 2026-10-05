import type { RepoColor } from "@/ipc/generated/RepoColor";

/*
 * 見出しの色の並びとラベル (docs/adr/0024-repo-heading-color.md)。
 *
 * 色の名前の源は Rust の `RepoColor`。**`satisfies` で全部の色にラベルがあることを
 * 型で縛る。** 色を足すとここが型エラーになる。見出しと色見本の CSS、トークン、
 * モックの突き合わせのテストはこの一覧から回すので、どれかを足し忘れると落ちる。
 */

const LABELS = {
  red: "赤",
  orange: "オレンジ",
  yellow: "黄",
  green: "緑",
  blue: "青",
  purple: "紫",
} as const satisfies Record<RepoColor, string>;

/** メニューに並べる順。`なし` はこの前に置く */
export const REPO_COLORS = Object.keys(LABELS) as readonly RepoColor[];

export function repoColorLabel(color: RepoColor): string {
  return LABELS[color];
}
