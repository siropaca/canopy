import { useEffect } from "react";

import * as ipc from "@/ipc/repos";
import { messageOf } from "@/shared/lib/errorMessage";

import { notifyFailure } from "./notify";
import { useRepoStore } from "./useRepoStore";
import { toUiState, useUiStore } from "./useUiStore";

/*
 * UI 状態の保存。
 *
 * 書き込みのたびではなく、まとめて書く (docs/adr/0016-store-without-plugin.md)。
 * 折りたたみは 1 クリックで数十件動くので、そのたびに書くとファイルを叩き続ける。
 */

export const SAVE_DEBOUNCE_MS = 400;

/**
 * 変更を見張って保存する。
 *
 * `enabled` は読み込みが終わってから true にする。
 * 読み込む前に保存すると、既定値で保存済みの内容を上書きする。
 */
export function usePersistUiState(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // 読み込み直後の状態はファイルの中身と同じ。ここを起点にすると、
    // 保存しない項目 (選択など) を触っただけで書きに行かない
    let lastSaved = JSON.stringify(toUiState(useUiStore.getState(), useRepoStore.getState().order));

    const flush = () => {
      const repos = useRepoStore.getState();
      // 設定が読めていないときは保存しない。壊れたファイルを上書きしない
      if (repos.loadError !== null) return;

      const uiState = toUiState(useUiStore.getState(), repos.order);
      const serialized = JSON.stringify(uiState);
      if (serialized === lastSaved) return;
      lastSaved = serialized;

      ipc.saveUiState(uiState).catch((error: unknown) => {
        // **握りつぶさない。** 黙って落とすと、再起動して並び順が戻ってから気づく
        notifyFailure(messageOf(error));
      });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    // 並び順はリポジトリのストアが持っているので、両方を見る
    const unsubscribeUi = useUiStore.subscribe(schedule);
    const unsubscribeRepos = useRepoStore.subscribe(schedule);
    return () => {
      // **保留中の変更を捨てない。** 開閉した直後に閉じると保存されずに消える
      clearTimeout(timer);
      flush();
      unsubscribeUi();
      unsubscribeRepos();
    };
  }, [enabled]);
}
