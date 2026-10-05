use tauri::{AppHandle, Runtime};

use super::CommandError;
use crate::window;

/*
 * ウィンドウの寸法に関わるコマンド。
 *
 * **フロントから Tauri のウィンドウ API を直接叩かせない。** 権限 (capabilities) を
 * 足すと、フロントがウィンドウを自由に動かせるようになる (docs/security.md)。
 * できることを「詳細ペインの開閉に合わせて幅の下限を変え、表示に戻すときに
 * 足りない幅を広げる」だけに絞る。広げるときは位置も動かす。
 */

/// Adjust the window to the detail pane being shown or hidden.
///
/// 隠すと幅の下限を 360px に下げ、出すと 720px に戻す。出すときに
/// ウィンドウが狭ければ広げる (docs/adr/0025-hide-detail-pane.md)。
/// **開閉の状態そのものは保存しない。** 保存は `save_ui_state` の 1 本。
#[tauri::command(rename_all = "snake_case")]
pub async fn set_detail_open<R: Runtime>(
    app: AppHandle<R>,
    open: bool,
) -> Result<(), CommandError> {
    let Some(main) = window::main_window(&app) else {
        return Err(CommandError::new("ウィンドウが見つかりません"));
    };
    window::apply_detail_open(&main, open)
        .map_err(|error| CommandError::new(format!("ウィンドウの幅を変えられません: {error}")))
}
