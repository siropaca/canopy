/**
 * class 名を組み立てる。
 *
 * CSS Modules の値は `string | undefined` なので (`noUncheckedIndexedAccess`)、
 * そのまま繋ぐと `undefined` が class に混ざる。false を渡せるので条件付きも書ける。
 */
export function classNames(...values: (string | false | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value !== "")
    .join(" ");
}
