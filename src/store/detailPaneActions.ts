import * as ipc from "@/ipc/window";
import { messageOf } from "@/shared/lib/errorMessage";

import { notifyFailure } from "./notify";
import { useUiStore } from "./useUiStore";

/*
 * 詳細ペインの開閉 (docs/adr/0025-hide-detail-pane.md)。
 *
 * 状態は `useUiStore` (永続化する)、ウィンドウの幅の下限は Rust が持つので、
 * **2 つをまたぐ操作はここに置く。開閉を変える入口はここ 1 本。** 状態だけ変えると、
 * 詳細ペインを隠してもウィンドウを細くできず、表示に戻しても狭いまま詳細ペインが潰れる。
 */

/**
 * いま Rust に送っている要求。
 *
 * **直列にする。** Tauri の async コマンドは呼び出しごとに並行に走るので、
 * 続けて押すと後の要求が先に効いて、隠しているのに下限が 720px のまま残ることがある
 * (docs/pitfalls.md)。
 */
let applying: Promise<void> = Promise.resolve();

/** サイドバーの `詳細パネル` */
export function toggleDetailPane(): Promise<void> {
  const open = !useUiStore.getState().detailOpen;
  useUiStore.setState({ detailOpen: open });
  applying = applying.then(() => apply(open));
  return applying;
}

async function apply(open: boolean): Promise<void> {
  try {
    await ipc.setDetailOpen(open);
  } catch (error) {
    // **握りつぶさない。** 開閉そのものは戻さない。見えている状態と保存が食い違うため
    notifyFailure(messageOf(error));
  }
}
