import { create, type StateCreator } from "zustand";

import type { RepoId } from "@/ipc/types";

/*
 * トースト。
 *
 * 右下に積む。件数と表示時間は docs/specs/ui.md の「トースト」。
 * **一括操作はリポジトリごとに出さない。** 11 件出すと上限を超えて失敗が押し出される。
 * 集約するのは `store/results.ts`。
 */

/** 表示時間 (ms)。失敗は長く残す。読み終える前に消えると原因が分からない */
export const SUCCESS_MS = 4000;
export const FAILURE_MS = 9000;
/** 同時に出す上限 */
export const MAX_TOASTS = 6;

export type ToastKind = "success" | "failure";

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  /** 本文。実行したコマンド、または失敗の要約 */
  readonly text: string;
  /** 本文の前に薄く出すリポジトリ名 */
  readonly repoName?: string | undefined;
  /** 本文を等幅で出すか。実行したコマンドのときだけ */
  readonly command?: boolean | undefined;
  /**
   * `詳細を見る` の飛び先。
   *
   * **コンソールに出す段があるときだけ入れる。** git を実行していない失敗は
   * 出力が無いので、リンクを出すと空のタブへ飛ばすことになる。
   */
  readonly detailRepoId?: RepoId | undefined;
}

export interface ToastStoreState {
  /** **新しいものが先頭。** 画面では上に積み上がる */
  readonly toasts: readonly Toast[];
  readonly nextId: number;
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  /** テストと後始末用。タイマーも止める */
  clear: () => void;
}

/**
 * 消えるまでのタイマー。
 *
 * ストアの外に置くのは、状態に入れるとシリアライズできない値が混ざるため。
 * **押し出したトーストのタイマーも止める。** 残すと後から発火する。
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function stopTimer(id: string): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

const creator: StateCreator<ToastStoreState> = (set, get) => ({
  toasts: [],
  nextId: 1,

  push: (toast) =>
    set((state) => {
      const id = `t${state.nextId}`;
      const toasts = [{ ...toast, id }, ...state.toasts];
      // 上限を超えた分は押し出す。**タイマーも止める**
      for (const pushedOut of toasts.slice(MAX_TOASTS)) {
        stopTimer(pushedOut.id);
      }
      timers.set(
        id,
        setTimeout(
          () => {
            get().dismiss(id);
          },
          toast.kind === "failure" ? FAILURE_MS : SUCCESS_MS,
        ),
      );
      return { toasts: toasts.slice(0, MAX_TOASTS), nextId: state.nextId + 1 };
    }),

  dismiss: (id) =>
    set((state) => {
      stopTimer(id);
      if (!state.toasts.some((toast) => toast.id === id)) return {};
      return { toasts: state.toasts.filter((toast) => toast.id !== id) };
    }),

  clear: () =>
    set(() => {
      for (const id of [...timers.keys()]) stopTimer(id);
      return { toasts: [], nextId: 1 };
    }),
});

export const useToastStore = create<ToastStoreState>()(creator);
