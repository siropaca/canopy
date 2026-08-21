import { useLayoutEffect, type RefObject } from "react";

/**
 * 要素に CSS 変数を当てる。
 *
 * 幅のような実行時に決まる値を CSS へ渡す手段。
 * JSX の `style` は使わない方針なので、CSSOM 経由で書く
 * (docs/security.md の「WebView」)。
 *
 * **`useLayoutEffect` で書く。** `useEffect` はペイントの後に走るので、
 * 保存した幅を読み込んだ直後の 1 フレームだけ CSS 側のフォールバック値で描かれる。
 */
export function useCssVariable(
  ref: RefObject<HTMLElement | null>,
  name: string,
  value: string,
): void {
  useLayoutEffect(() => {
    ref.current?.style.setProperty(name, value);
  }, [ref, name, value]);
}
