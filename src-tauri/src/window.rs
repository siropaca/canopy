//! Remembering and restoring the window's position and size.
//!
//! 常駐するので、閉じて (隠して) 戻したときも同じ場所に出す
//! (docs/adr/0011-residency.md)。保存先はアプリ自身の設定ファイル
//! (docs/specs/data-model.md の `UiState`)。
//!
//! **単位は論理ピクセルで揃える。** 物理ピクセルで保存すると、
//! 倍率の違うディスプレイへ移したときに寸法が 2 倍になる。

use tauri::Manager;

use crate::model::WindowState;

/// Label of the only window.
///
/// `tauri.conf.json` の `label` と同じ値。ずれたら
/// `label_matches_the_window_configuration` が落ちる。
pub const MAIN_WINDOW: &str = "main";

/// Smallest window we are willing to restore.
///
/// `tauri.conf.json` の `minWidth` / `minHeight` と同じ値。
/// ずれたら `minimums_match_the_window_configuration` が落ちる。
pub const MIN_WIDTH: f64 = 720.0;
pub const MIN_HEIGHT: f64 = 420.0;

/// How much of the window has to land on a screen to count as visible.
///
/// タイトルバーを掴める程度の重なりがあれば「見えている」とする。
const VISIBLE_WIDTH: f64 = 80.0;
const VISIBLE_HEIGHT: f64 = 40.0;

/// Whether the saved geometry is worth restoring.
///
/// **0 や負の寸法を捨てる。** 隠した瞬間や最小化した瞬間の値が来ることがあり、
/// そのまま戻すと次の起動でウィンドウが出てこない。
pub fn is_usable(window: &WindowState) -> bool {
    window.x.is_finite()
        && window.y.is_finite()
        && window.width >= MIN_WIDTH
        && window.height >= MIN_HEIGHT
}

/// One monitor's area, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Whether enough of the window would land on one of the screens.
///
/// 外部ディスプレイを外すと、保存した位置が画面の外になる。そのまま戻すと
/// **ウィンドウがどこにも見えない**ので、[`geometry_to_apply`] がその値を捨てる。
/// 捨てたときは `tauri.conf.json` の初期値のまま出す (docs/specs/ui.md)。
///
/// 画面の一覧が空のときは `true`。判定できないなら動かさない。
pub fn is_on_screen(window: &WindowState, screens: &[Screen]) -> bool {
    if screens.is_empty() {
        return true;
    }
    screens.iter().any(|screen| {
        let overlap_width =
            (window.x + window.width).min(screen.x + screen.width) - window.x.max(screen.x);
        let overlap_height =
            (window.y + window.height).min(screen.y + screen.height) - window.y.max(screen.y);
        overlap_width >= VISIBLE_WIDTH && overlap_height >= VISIBLE_HEIGHT
    })
}

/// Read the window's geometry in logical pixels.
///
/// 位置は外枠、寸法は中身にする。戻すときも同じ組み合わせで指定する。
pub fn geometry<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<WindowState> {
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// Every monitor Tauri can see, in logical pixels.
pub fn screens<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Vec<Screen> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            Screen {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

/// Geometry that may be applied as-is.
///
/// 保存が無い、値が使えない、画面の外になる、のどれかなら `None`。
/// **判断はここ 1 本。** `restore` に散らすと、`tauri::WebviewWindow` が要るせいで
/// テストが付かないまま条件が増える。
pub fn geometry_to_apply(saved: Option<WindowState>, screens: &[Screen]) -> Option<WindowState> {
    saved
        .filter(is_usable)
        .filter(|window| is_on_screen(window, screens))
}

/// Put the window back where it was. 戻せない値なら何もしない。
pub fn restore<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, saved: Option<WindowState>) {
    let Some(saved) = geometry_to_apply(saved, &screens(window)) else {
        return;
    };
    let _ = window.set_size(tauri::LogicalSize::new(saved.width, saved.height));
    let _ = window.set_position(tauri::LogicalPosition::new(saved.x, saved.y));
}

/// Geometry worth remembering, read from the window itself.
///
/// **隠した瞬間・最小化した瞬間・フルスクリーンの値を捨てる。**
/// フルスクリーンの枠はメニューバーの下に潜るので、そのまま戻すとタイトルバーを
/// 掴めなくなる。判断を `lib.rs` に置くと、`tauri::WebviewWindow` が要るせいで
/// テストが付かないまま条件が増える。
pub fn worth_keeping<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<WindowState> {
    if !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
    {
        return None;
    }
    geometry(window).filter(is_usable)
}

/// The only window.
pub fn main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    // `Manager::get_window` は unstable feature の裏にあるので使わない
    app.get_webview_window(MAIN_WINDOW)
}

/// Bring the window back.
///
/// メニューバーのアイコンと、Dock / 2 個目の起動からの復帰で呼ぶ
/// (docs/adr/0011-residency.md)。
/// **可視性をフロントへ知らせない。** WebView 側の `visibilitychange` が
/// 隠す・最小化する・別のデスクトップへ移すのを全部拾うので、こちらから
/// 送ると経路が 2 本になる (docs/specs/ui.md の「ウィンドウと常駐」)。
pub fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Hide the window instead of closing it. **プロセスは終了しない。**
pub fn hide_main<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.hide();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(x: f64, y: f64, width: f64, height: f64) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
        }
    }

    fn screen(x: f64, y: f64, width: f64, height: f64) -> Screen {
        Screen {
            x,
            y,
            width,
            height,
        }
    }

    /// 下限は `tauri.conf.json` の `minWidth` / `minHeight` と揃える。
    /// ずれると、設定より小さいウィンドウを復元しようとして噛み合わなくなる
    #[test]
    fn minimums_match_the_window_configuration() {
        let raw = include_str!("../tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(raw).expect("tauri.conf.json should parse");
        let declared = &config["app"]["windows"][0];

        assert_eq!(declared["minWidth"].as_f64(), Some(MIN_WIDTH));
        assert_eq!(declared["minHeight"].as_f64(), Some(MIN_HEIGHT));
    }

    /// 保存が無いときは中央に出す。
    ///
    /// **これが無いと画面の外に出ることがある** (実測。初回起動でウィンドウの上端が
    /// メニューバーの 977px 上に来た)。復元する値があるときは `restore` が上書きする
    #[test]
    fn centres_the_window_when_there_is_nothing_to_restore() {
        let raw = include_str!("../tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(raw).expect("tauri.conf.json should parse");

        assert_eq!(config["app"]["windows"][0]["center"].as_bool(), Some(true));
    }

    /// ウィンドウのラベルは `tauri.conf.json` の宣言と揃える。
    /// ずれると復帰も位置の復元も静かに効かなくなる
    #[test]
    fn label_matches_the_window_configuration() {
        let raw = include_str!("../tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(raw).expect("tauri.conf.json should parse");

        assert_eq!(
            config["app"]["windows"][0]["label"].as_str(),
            Some(MAIN_WINDOW)
        );
    }

    /// 使える値はそのまま戻す
    #[test]
    fn accepts_a_geometry_inside_the_limits() {
        assert!(is_usable(&window(120.0, 80.0, 1180.0, 760.0)));
        assert!(is_usable(&window(-1200.0, -40.0, 720.0, 420.0)));
    }

    /// 隠した瞬間や最小化した瞬間の値を戻すとウィンドウが出てこない
    #[test]
    fn rejects_a_geometry_that_would_hide_the_window() {
        assert!(!is_usable(&window(0.0, 0.0, 0.0, 0.0)));
        assert!(!is_usable(&window(0.0, 0.0, 719.0, 760.0)));
        assert!(!is_usable(&window(0.0, 0.0, 1180.0, 419.0)));
        assert!(!is_usable(&window(f64::NAN, 0.0, 1180.0, 760.0)));
        assert!(!is_usable(&window(0.0, f64::INFINITY, 1180.0, 760.0)));
    }

    /// 画面の中にあるなら戻す
    #[test]
    fn keeps_a_window_that_lands_on_a_screen() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert!(is_on_screen(&window(100.0, 100.0, 1180.0, 760.0), &screens));
    }

    /// 外部ディスプレイを外すと、保存した位置は画面の外になる
    #[test]
    fn rejects_a_window_that_lands_off_every_screen() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        // 右の外部ディスプレイに置いていた位置
        assert!(!is_on_screen(
            &window(2000.0, 200.0, 1180.0, 760.0),
            &screens
        ));
        // 上に外していた位置
        assert!(!is_on_screen(
            &window(100.0, -900.0, 1180.0, 760.0),
            &screens
        ));
    }

    /// 2 枚目の画面に載っているなら戻す
    #[test]
    fn keeps_a_window_on_a_second_screen() {
        let screens = [
            screen(0.0, 0.0, 1512.0, 982.0),
            screen(1512.0, -300.0, 2560.0, 1440.0),
        ];

        assert!(is_on_screen(
            &window(2000.0, 200.0, 1180.0, 760.0),
            &screens
        ));
    }

    /// 端に少し掛かっているだけでは掴めない。**80x40 の重なりを要求する**
    #[test]
    fn requires_enough_overlap_to_grab_the_window() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        // 右端に 79px だけ残っている
        assert!(!is_on_screen(
            &window(1512.0 - 79.0, 100.0, 1180.0, 760.0),
            &screens
        ));
        // 80px 残っていれば掴める
        assert!(is_on_screen(
            &window(1512.0 - 80.0, 100.0, 1180.0, 760.0),
            &screens
        ));
        // 下端に 39px だけ残っている
        assert!(!is_on_screen(
            &window(100.0, 982.0 - 39.0, 1180.0, 760.0),
            &screens
        ));
        assert!(is_on_screen(
            &window(100.0, 982.0 - 40.0, 1180.0, 760.0),
            &screens
        ));
    }

    /// 戻してよい値だけを通す。**単体の判定が厳しくても、使う側が呼ばなければ意味が無い**
    #[test]
    fn applies_only_a_geometry_that_would_show_up() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];
        let good = window(120.0, 80.0, 1180.0, 760.0);

        assert_eq!(geometry_to_apply(Some(good), &screens), Some(good));
        // 保存が無い
        assert_eq!(geometry_to_apply(None, &screens), None);
        // 隠した瞬間の 0 サイズ
        assert_eq!(
            geometry_to_apply(Some(window(0.0, 0.0, 0.0, 0.0)), &screens),
            None
        );
        // 外した外部ディスプレイの位置
        assert_eq!(
            geometry_to_apply(Some(window(2000.0, 200.0, 1180.0, 760.0)), &screens),
            None
        );
    }

    /// 画面の一覧が引けないときは動かさない
    #[test]
    fn leaves_the_window_alone_when_no_screen_is_known() {
        assert!(is_on_screen(&window(9000.0, 9000.0, 1180.0, 760.0), &[]));
    }
}
