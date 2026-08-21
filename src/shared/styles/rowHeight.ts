/**
 * ツリーとリストの行高 (px)。
 *
 * 仮想化に数値で渡す必要があるので、CSS 変数と二重に持っている。
 * `--row` とずれると行が重なるので、`tokens.test.ts` が一致を確認する。
 */
export const ROW_HEIGHT = 21;
