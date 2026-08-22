/**
 * ツリーとリストの行高 (px)。
 *
 * 仮想化に数値で渡す必要があるので、CSS 変数と二重に持っている。
 * `--row` とずれると行が重なるので、`tokens.test.ts` が一致を確認する。
 */
export const ROW_HEIGHT = 21;

/**
 * コンソールの出力 1 行ぶんの高さ (px)。
 *
 * 折り返すと高さが変わるので、仮想化にはこれを**初期値**として渡して
 * 実際の高さは実測させる (`VirtualRows` の `measure`)。
 * `--console-line` とずれると初期表示のスクロール量がずれるので、
 * `tokens.test.ts` が一致を確認する。
 */
export const CONSOLE_LINE_HEIGHT = 19;
