pub mod commands;
pub mod git;
pub mod model;
pub mod queue;
pub mod state;
pub mod store;

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
        commands::repo::list_repos,
        commands::repo::get_ui_state,
        commands::repo::save_ui_state,
        commands::repo::add_repo,
        commands::repo::remove_repo,
        commands::repo::get_repo_snapshot,
    ]
}

/// Start the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        // フォルダ選択は Rust 側から開く。フロントには権限を与えない
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(invoke_handler())
        .setup(|app| {
            let settings = tauri::Manager::path(app)
                .app_config_dir()
                .expect("the app config directory should be known")
                .join(state::SETTINGS_FILE);
            tauri::Manager::manage(app, state::AppState::load(settings));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Tauri application");
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
