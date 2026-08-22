// jsdom を使うテストの共通後始末と、足りない API の補い。
// globals を有効にしていないので、React Testing Library の自動 cleanup が効かない。
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/*
 * jsdom には `ResizeObserver` が無く、レイアウトも無い。
 *
 * 仮想リストはスクロール要素の寸法が 0 だと**行を 1 つも描かない** (実測)。
 * 中身が出ているかをテストで確かめられないので、監視の代わりに
 * 「観測した瞬間に 1 回だけ寸法を知らせる」スタブを置く。
 *
 * 寸法はテストが `getBoundingClientRect` を差し替えて決める。
 * 差し替えていなければ既定のビューポート寸法を返す。0 のままだと
 * 「描かれないこと」と「描く範囲が無いこと」を区別できない。
 */
const DEFAULT_VIEWPORT = { width: 800, height: 600 };

class ResizeObserverStub implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const width = rect.width || DEFAULT_VIEWPORT.width;
    const height = rect.height || DEFAULT_VIEWPORT.height;
    const entry = {
      target,
      contentRect: rect,
      borderBoxSize: [{ inlineSize: width, blockSize: height }],
      contentBoxSize: [{ inlineSize: width, blockSize: height }],
      devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this);
  }

  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
});
