import { create, type StateCreator } from "zustand";

import type { RepoId } from "@/ipc/types";
import type { ConsoleBlock, IdentifiedBlock } from "@/shared/lib/consoleLog";

/*
 * コンソールの中身。
 *
 * リポジトリごとのタブを持ち、出力があったリポジトリの分だけ増える
 * (docs/specs/ui.md の「コンソール」)。パネルの開閉は `useUiStore` が持つ
 * (永続化するのはそちらだけ)。
 *
 * **出力は捨てない。** タブを閉じたときだけ消える。
 */

/** 積み上げたブロック。鍵は仮想リストの key に使う */
export type ConsoleEntry = IdentifiedBlock;

export interface ConsoleStoreState {
  /** リポジトリごとの出力。**挿入順がタブの並び** */
  readonly blocks: ReadonlyMap<RepoId, readonly ConsoleEntry[]>;
  readonly activeTab: RepoId | null;
  /** 失敗を含む出力が届いてから、そのタブを開くまでのあいだ立つ印 */
  readonly failed: ReadonlySet<RepoId>;
  /** 次に振るブロックの番号 */
  readonly nextBlockId: number;

  /**
   * 出力を足す。
   *
   * **見ているタブは切り替えない。** 一括フェッチの途中で表示が飛ぶ。
   * `failed` を立てるかは呼び出し側 (`store/results.ts`) が決める。
   * 見ているタブの失敗に印を付けても、消すための操作が無い。
   */
  append: (repoId: RepoId, blocks: readonly ConsoleBlock[], options: { failed: boolean }) => void;
  /** タブを開く。赤いドットはここで消える */
  openTab: (repoId: RepoId) => void;
  closeTab: (repoId: RepoId) => void;
  /** リストから削除されたリポジトリを忘れる */
  forget: (repoId: RepoId) => void;
}

const creator: StateCreator<ConsoleStoreState> = (set) => ({
  blocks: new Map(),
  activeTab: null,
  failed: new Set(),
  nextBlockId: 1,

  append: (repoId, incoming, options) =>
    set((state) => {
      if (incoming.length === 0) return {};
      let nextBlockId = state.nextBlockId;
      const added = incoming.map((block) => ({ ...block, id: `b${nextBlockId++}` }));
      const blocks = new Map(state.blocks);
      blocks.set(repoId, [...(state.blocks.get(repoId) ?? []), ...added]);

      return {
        blocks,
        nextBlockId,
        // 見ているタブは切り替えない。まだ 1 つも無いときだけ開く
        activeTab: state.activeTab ?? repoId,
        failed: options.failed ? withMark(state.failed, repoId) : state.failed,
      };
    }),

  openTab: (repoId) =>
    set((state) => {
      // **出力の無いタブは開かない。** タブ一覧に出ない鍵を選ぶと、
      // どのタブも選ばれていないのに本文が空、という戻せない状態になる
      if (!state.blocks.has(repoId)) return { failed: withoutMark(state.failed, repoId) };
      return { activeTab: repoId, failed: withoutMark(state.failed, repoId) };
    }),

  closeTab: (repoId) => set((state) => dropped(state, repoId)),

  forget: (repoId) => set((state) => dropped(state, repoId)),
});

/** そのリポジトリのタブを消す。開いていたタブなら隣へ移る */
function dropped(state: ConsoleStoreState, repoId: RepoId): Partial<ConsoleStoreState> {
  if (!state.blocks.has(repoId)) {
    return { failed: withoutMark(state.failed, repoId) };
  }
  const tabs = consoleTabs(state);
  const blocks = new Map(state.blocks);
  blocks.delete(repoId);

  let activeTab = state.activeTab;
  if (activeTab === repoId) {
    const at = tabs.indexOf(repoId);
    // 閉じた位置に来るタブへ移る。末尾を閉じたなら 1 つ前
    activeTab = tabs[at + 1] ?? tabs[at - 1] ?? null;
  }
  return { blocks, activeTab, failed: withoutMark(state.failed, repoId) };
}

function withMark(failed: ReadonlySet<RepoId>, repoId: RepoId): ReadonlySet<RepoId> {
  const next = new Set(failed);
  next.add(repoId);
  return next;
}

function withoutMark(failed: ReadonlySet<RepoId>, repoId: RepoId): ReadonlySet<RepoId> {
  if (!failed.has(repoId)) return failed;
  const next = new Set(failed);
  next.delete(repoId);
  return next;
}

/** タブの並び。出力が届いた順 */
export function consoleTabs(state: Pick<ConsoleStoreState, "blocks">): RepoId[] {
  return [...state.blocks.keys()];
}

export const useConsoleStore = create<ConsoleStoreState>()(creator);

/** テスト用に独立したストアを作る */
export const createConsoleStore = () => create<ConsoleStoreState>()(creator);
