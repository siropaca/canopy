/**
 * ホームディレクトリを `~` に縮める。
 *
 * パスの省略は末尾を省く普通の `text-overflow` にする。
 * `direction: rtl` を当てると先頭のスラッシュが末尾に回る (docs/pitfalls.md)。
 */
export function shortenHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
