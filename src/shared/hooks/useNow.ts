import { useSyncExternalStore } from "react";

/*
 * いまの時刻。
 *
 * 相対時刻の表示に使う。`Date.now()` を描画中に呼ぶと純粋でなくなるので
 * (再描画のたびに値が変わる)、外部のストアとして持つ。
 */

/** 表示は分単位。1 分ごとに配る */
const TICK_MS = 60_000;

let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function snapshot(): number {
  // 誰も購読していないうちは 0 のままなので、その場で埋める
  if (current === 0) current = Date.now();
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
