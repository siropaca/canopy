/**
 * 例外を人に見せる 1 行にする。
 *
 * Tauri は `Err` を文字列 1 本にして reject する。知らない形も**捨てずに**出す
 * (AGENTS.md の「エラーを握りつぶさない」)。
 */
export function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return `不明なエラー: ${JSON.stringify(error)}`;
}
