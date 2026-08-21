/**
 * 未コミットの一覧に出す件数。
 *
 * Rust 側は `ChangeList::MAX_ITEMS` (21) で切って総数を別に渡す。
 * **ここは 20。** 20 件出して残りを `他 n 件` にまとめる (docs/specs/ui.md)。
 * 21 = 20 + 1 の関係が崩れると `他 n 件` の n が実際とずれるので、
 * `changeList.test.ts` が Rust 側の定数と突き合わせる。
 */
export const FILE_LIMIT = 20;
