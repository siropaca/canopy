import { useEffect, useRef, useState, type RefObject } from "react";

import type { RepoId, RowNode } from "@/ipc/types";
import { insertionIndexAt, insertionOffset, repoBlocks } from "@/shared/lib/reorder";
import { ROW_HEIGHT } from "@/shared/styles/rowHeight";
import { moveRepository } from "@/store/orderActions";

/*
 * リポジトリ見出しのドラッグ並び替え。
 *
 * **落とす位置は仮想化リストのインデックスから決める。** 画面外の行は DOM から
 * 消えるので、要素を探す形にすると離れたリポジトリに落とせない
 * (docs/adr/0019-reorder-without-dnd-kit.md)。
 * **掴む行だけは DOM から取る。** 掴む行は必ずポインタの下にあるので DOM にあり、
 * 行の位置を座標から逆算する必要がない。
 *
 * 座標の原点は行を並べている器 (`rowsLayer`)。スクロール要素を原点にすると、
 * 上に余白を 1 つ足しただけで掴む行と落ちる位置が黙ってずれる。
 *
 * ドラッグできるのはリポジトリ見出しだけ。ブランチの行は動かせない
 * (docs/specs/ui.md の「リポジトリ見出し」)。
 */

/** ここを超えて動いたらドラッグ。超えるまではただの選択 */
const THRESHOLD = 4;
/** 端からこの距離に入ったらスクロールする */
const EDGE = 24;
/** オートスクロールの速さ (1 フレームあたり px) */
const SPEED = 12;

export interface RepoDrag {
  /** 掴んでいるリポジトリ */
  readonly repoId: RepoId;
  /** 挿入位置 (動かす前の並びでの位置) */
  readonly index: number;
  /** 挿入線を描く高さ。行を並べている器の先頭からの距離 */
  readonly offset: number;
}

/**
 * ドラッグ中の状態を返す。`null` なら掴んでいない。
 *
 * 掴む・動かす・落とすの購読は素の DOM に張る。React の合成イベントにしないのは、
 * ポインタが要素の外へ出てもドラッグを続けるため。
 */
export function useRepoDrag(
  rows: readonly RowNode[],
  viewport: HTMLElement | null,
  rowsLayer: RefObject<HTMLElement | null>,
): RepoDrag | null {
  const [drag, setDrag] = useState<RepoDrag | null>(null);

  // 掴んでいる最中に届いたスナップショットで行数が変わる。**最新を見る**
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    const layer = rowsLayer.current;
    if (viewport === null || layer === null) return;

    /** 掴んでいるリポジトリ。掴んでいなければ null */
    let grabbed: { readonly repoId: RepoId; readonly startY: number } | null = null;
    /** しきい値を超えたか */
    let dragging = false;
    /** 直近のポインタの位置。オートスクロール中の再計算に使う */
    let pointerY = 0;
    /** オートスクロールのフレーム */
    let frame: number | null = null;
    /** 落とす位置。state は次の描画まで読めないので同じものを持っておく */
    let target: RepoDrag | null = null;

    const stopScrolling = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };

    const finish = () => {
      grabbed = null;
      dragging = false;
      target = null;
      stopScrolling();
      setDrag(null);
    };

    /** ポインタの位置から挿入位置を出す */
    const update = () => {
      if (grabbed === null) return;
      const blocks = repoBlocks(rowsRef.current);
      const index = insertionIndexAt(
        blocks,
        pointerY - layer.getBoundingClientRect().top,
        ROW_HEIGHT,
      );
      target = {
        repoId: grabbed.repoId,
        index,
        offset: insertionOffset(blocks, index, ROW_HEIGHT),
      };
      setDrag(target);
    };

    /** 端に入っているあいだスクロールし続ける */
    const scrollIfAtEdge = () => {
      if (!dragging) return;
      const rect = viewport.getBoundingClientRect();
      const speed = pointerY < rect.top + EDGE ? -SPEED : pointerY > rect.bottom - EDGE ? SPEED : 0;
      if (speed === 0) {
        stopScrolling();
        return;
      }
      viewport.scrollTop += speed;
      update();
      frame = requestAnimationFrame(scrollIfAtEdge);
    };

    /** その座標にある行。掴む行は必ず DOM にある */
    const rowAt = (event: PointerEvent): RowNode | undefined => {
      const element = event.target instanceof Element ? event.target.closest("[data-index]") : null;
      if (!(element instanceof HTMLElement)) return undefined;
      const index = Number(element.dataset.index);
      return Number.isInteger(index) ? rowsRef.current[index] : undefined;
    };

    const onPointerDown = (event: PointerEvent) => {
      // **前のドラッグを持ち越さない。** 取りこぼした pointerup が残っていると、
      // 触っていないのに並びが変わる
      finish();
      // 左ボタンだけ。右クリックはメニュー
      if (event.button !== 0) return;
      const row = rowAt(event);
      if (row === undefined || row.kind !== "repo") return;
      // **`preventDefault` しない。** 選択は mousedown で拾っている (docs/pitfalls.md)
      grabbed = { repoId: row.repoId, startY: event.clientY };
      pointerY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (grabbed === null) return;
      // ボタンを離した瞬間を取りこぼしていたら、ここで畳む
      if (event.buttons === 0) {
        finish();
        return;
      }
      pointerY = event.clientY;
      if (!dragging) {
        if (Math.abs(event.clientY - grabbed.startY) < THRESHOLD) return;
        dragging = true;
      }
      update();
      if (frame === null) scrollIfAtEdge();
    };

    const onPointerUp = () => {
      const dropped = dragging ? target : null;
      finish();
      if (dropped !== null) moveRepository(dropped.repoId, dropped.index);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // 取り消し。並びは変えない
      if (event.key === "Escape") finish();
    };

    layer.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      layer.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKeyDown);
      // 器が入れ替わったら掴んでいる表示も畳む。挿入線が残ったままになる
      finish();
    };
  }, [viewport, rowsLayer]);

  return drag;
}
