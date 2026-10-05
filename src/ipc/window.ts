import { invoke } from "@tauri-apps/api/core";

import { COMMANDS } from "./commands";

/*
 * ウィンドウの寸法に関わるコマンドの薄いラッパ。
 *
 * フロントは Tauri のウィンドウ API を直接叩かない (docs/adr/0025-hide-detail-pane.md)。
 */

/**
 * 詳細ペインの開閉をウィンドウに伝える。
 *
 * Rust 側が幅の下限を切り替え、表示に戻すときは狭ければ広げる。
 * **開閉の保存はしない。** 保存は `saveUiState` の 1 本。
 */
export function setDetailOpen(open: boolean): Promise<void> {
  return invoke<void>(COMMANDS.setDetailOpen, { open });
}
