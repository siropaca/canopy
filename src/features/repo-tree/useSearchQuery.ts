import { useCallback, useEffect, useRef, useState } from "react";

import { useUiStore } from "@/store/useUiStore";

/*
 * 検索語の入力。
 *
 * 打った文字はすぐ画面に出し、**絞り込みだけ遅らせる。**
 * 1 文字打つごとに全リポジトリの ref をツリー化するので、打っている間ずっと
 * 再計算すると引っかかる (docs/plans/phase-3-around.md の完了条件)。
 *
 * **正はストアの `query`。** 入力欄はその写しで、外から変わったら合わせる。
 * 合わせないと、クリアや復元で「入力欄には文字が残っているのに絞り込まれていない」
 * というずれ方をする。
 */

/** 入力が止まってから絞り込むまで (ms) */
export const SEARCH_DEBOUNCE_MS = 120;

export interface SearchQuery {
  /** 入力欄に出す文字。ストアより先に動く */
  readonly text: string;
  /** 打鍵。絞り込みは `SEARCH_DEBOUNCE_MS` だけ遅れる */
  readonly setText: (text: string) => void;
  /** クリア。**遅らせず**に入力欄とストアの両方を空にする */
  readonly clear: () => void;
}

export function useSearchQuery(): SearchQuery {
  const query = useUiStore((state) => state.query);
  const [text, setText] = useState(query);
  // 自分が書いた値。ストアからの追従と区別するために覚えておく
  const written = useRef(query);

  useEffect(() => {
    const timer = setTimeout(() => {
      // 同じ語なら書かない。ツリーの再計算を無駄に起こさない
      if (useUiStore.getState().query === text) return;
      written.current = text;
      useUiStore.getState().setQuery(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    // 外から変わったときだけ入力欄を合わせる (自分の書き込みは無視する)
    if (query === written.current) return;
    written.current = query;
    setText(query);
  }, [query]);

  const clear = useCallback(() => {
    // 待たせない。ここでストアも空にするので、絞り込みもこの場で解ける。
    // 自分の書き込みとして覚えておかないと、この後の追従で入力欄を上書きしてしまう
    written.current = "";
    setText("");
    useUiStore.getState().setQuery("");
  }, []);

  return { text, setText, clear };
}
