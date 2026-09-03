//! The menu bar icon.
//!
//! ウィンドウを閉じてもプロセスは終わらないので、**戻る手段と終わる手段**を
//! ここに置く (docs/adr/0011-residency.md)。
//!
//! アイコンはアプリのアイコンを使い回す。テンプレート (単色) にはしない。
//! いまのアイコンは角丸の面が主なので、alpha だけで塗ると黒い四角になる。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::window;

/// Ids of the menu items. 文言のルールは docs/specs/ui.md の「文言のルール」。
const SHOW: &str = "show";
const QUIT: &str = "quit";

/// Put the icon in the menu bar.
pub fn install<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW, "ウィンドウを表示", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY)
        .tooltip("Canopy")
        .menu(&menu)
        // 左クリックはウィンドウの復帰に使う。メニューは右クリックから出す
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW => window::show_main(app),
            // **閉じても終了しないので、終わる手段はここだけ**
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::show_main(tray.app_handle());
            }
        });
    // アイコンが取れないときもメニューバーには出す (macOS は空の枠を描く)。
    // 黙って常駐だけして終われなくなるより、出しておく方が良い
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Id of the only tray icon.
const MAIN_TRAY: &str = "main";
