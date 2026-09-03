pub mod commands;
pub mod git;
pub mod model;
pub mod op_kind;
pub mod ops;
pub mod os;
pub mod queue;
pub mod state;
pub mod store;
pub mod tray;
pub mod window;

/// Whether the WebView may navigate to `url`.
///
/// 外部サイトへ遷移させない。ウィンドウが外部ページに乗っ取られると、
/// そのページが同じ WebView から自前コマンドを叩ける状態になる (docs/security.md)。
fn allows_navigation(url: &tauri::Url, is_dev: bool) -> bool {
    match url.scheme() {
        // Production loads the bundled assets through Tauri's own protocols.
        "tauri" | "ipc" => true,
        // Only the Vite dev server, and only while developing.
        "http" => is_dev && url.host_str() == Some("localhost"),
        _ => false,
    }
}

/// Plugin that applies [`allows_navigation`] to every webview.
///
/// The window is declared in `tauri.conf.json`, so there is no
/// `WebviewWindowBuilder` to attach the handler to.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| allows_navigation(url, tauri::is_dev()))
        .build()
}

/// Every command the frontend may call.
///
/// `run()` から切り出しているのは、統合テストが `tauri::test::mock_builder()` に
/// 同じ集合を渡せるようにするため。コマンドのラッパは手書きなので、引数名の
/// 間違いは型では防げない (docs/adr/0013-type-generation.md)。
pub fn invoke_handler<R: tauri::Runtime>()
-> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::settings::list_repos,
        commands::settings::get_ui_state,
        commands::settings::save_ui_state,
        commands::settings::add_repo,
        commands::settings::remove_repo,
        commands::snapshot::get_repo_snapshot,
        commands::ops::fetch_repo,
        commands::ops::fetch_all,
        commands::ops::pull_current,
        commands::ops::fast_forward_branch,
        commands::ops::checkout_branch,
        commands::ops::checkout_tag,
        commands::ops::checkout_and_pull,
        commands::ops::checkout_previous,
        commands::ops::push_branch,
        commands::ops::rename_branch,
        commands::ops::get_push_preview,
        commands::ops::reveal_in_finder,
        commands::ops::open_in_terminal,
    ]
}

use tauri::Manager;

/// What to do with one window event.
///
/// **閉じる要求は隠すに読み替える。** プロセスを終わらせない
/// (docs/adr/0011-residency.md)。位置とサイズはここで控える。
fn on_window_event<R: tauri::Runtime>(win: &tauri::Window<R>, event: &tauri::WindowEvent) {
    // **どのウィンドウのイベントかを見る。** ハンドラは全ウィンドウ共通なので、
    // 2 枚目を足したときに「サブウィンドウが閉じずに本体が消える」ことになる
    if win.label() != window::MAIN_WINDOW {
        return;
    }
    // 位置を触る API は `WebviewWindow` の側にある
    let Some(main) = window::main_window(win.app_handle()) else {
        return;
    };
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            // **隠す前に控える。** 隠したあとでは寸法が読めない
            remember_window(&main);
            window::hide_main(&main);
            // 隠す時点で書き出す。次に走るのは終了時だけ
            save_window(win.app_handle(), Wait::No);
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => remember_window(&main),
        _ => {}
    }
}

/// Remember the window's geometry, if the value is worth keeping.
///
/// 捨てる条件は `window::worth_keeping` の 1 本 (テストが付いている側)。
fn remember_window<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    let Some(geometry) = window::worth_keeping(win) else {
        return;
    };
    if let Some(state) = win.try_state::<state::AppState>() {
        state.record_window(geometry);
    }
}

/// Whether to wait for the write. 終了時だけ待つ。
enum Wait {
    Yes,
    No,
}

/// Write the remembered geometry. 呼ぶのは隠したときと終了するときだけ。
///
/// **報告はここ 1 本。** 2 形に分けると、伝え方を変えたときに片方だけ直る。
fn save_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, wait: Wait) {
    let app = app.clone();
    let write = async move {
        if let Some(state) = app.try_state::<state::AppState>()
            && let Err(error) = state.save_window().await
        {
            // 握りつぶさない。位置の保存はフロントに出す先が無いので stderr へ
            eprintln!("canopy: ウィンドウの位置を保存できませんでした: {error}");
        }
    };
    match wait {
        // 終了直前なので待つ。待たないと位置が保存されない
        Wait::Yes => tauri::async_runtime::block_on(write),
        Wait::No => {
            tauri::async_runtime::spawn(write);
        }
    }
}

/// Last thing the app does.
///
/// **走っている git を孫まで畳む。** `kill_on_drop` は future を落としたときだけ
/// 効くので、プロセスが終わる経路では走らない (docs/adr/0020-process-group-kill.md)。
fn shut_down<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let killed = git::kill_running_children();
    if killed > 0 {
        eprintln!("canopy: 実行中の git を {killed} 件終了しました");
    }
    // 隠さずに終了したときも位置を残す。隠れているなら最後に見えていた値が残る
    if let Some(main) = window::main_window(app) {
        remember_window(&main);
    }
    save_window(app, Wait::Yes);
}

/// Start the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        // フォルダ選択は Rust 側から開く。フロントには権限を与えない
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(invoke_handler())
        .setup(|app| {
            let settings = app
                .path()
                .app_config_dir()
                .expect("the app config directory should be known")
                .join(state::SETTINGS_FILE);
            let state = state::AppState::load(settings);
            let saved = state.initial_window();
            app.manage(state);

            // 位置を戻すのは 1 回だけ。中身を描く前に済ませる
            if let Some(main) = window::main_window(app.handle()) {
                window::restore(&main, saved);
            }
            tray::install(app.handle())?;
            Ok(())
        })
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("failed to start the Tauri application")
        .run(|app, event| match event {
            // Dock のアイコンと、2 個目の起動から戻ってくる。
            // macOS は同じ bundle id の `.app` を二重に起動しない
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => window::show_main(app),
            tauri::RunEvent::Exit => shut_down(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> tauri::Url {
        tauri::Url::parse(raw).expect("test URL should parse")
    }

    /// 本番でアセットを読む経路は許す
    #[test]
    fn allows_the_tauri_protocol() {
        assert!(allows_navigation(
            &url("tauri://localhost/index.html"),
            false
        ));
        assert!(allows_navigation(&url("ipc://localhost/get_repo"), false));
    }

    /// 外部サイトへの遷移は拒否する
    #[test]
    fn rejects_external_sites() {
        assert!(!allows_navigation(
            &url("https://github.com/siropaca"),
            false
        ));
        assert!(!allows_navigation(
            &url("https://github.com/siropaca"),
            true
        ));
        assert!(!allows_navigation(&url("file:///etc/passwd"), true));
    }

    /// 開発サーバは開発中だけ許す
    #[test]
    fn allows_the_dev_server_only_while_developing() {
        assert!(allows_navigation(&url("http://localhost:1420/"), true));
        assert!(!allows_navigation(&url("http://localhost:1420/"), false));
        assert!(!allows_navigation(&url("http://example.com/"), true));
    }
}
