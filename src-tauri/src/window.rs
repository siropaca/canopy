//! Remembering and restoring the window's position and size, and its width limit.
//!
//! 常駐するので、閉じて (隠して) 戻したときも同じ場所に出す
//! (docs/adr/0011-residency.md)。保存先はアプリ自身の設定ファイル
//! (docs/specs/data-model.md の `UiState`)。
//!
//! 幅の下限は詳細ペインの開閉で変わる (docs/adr/0025-hide-detail-pane.md)。
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

/// Smallest window while the detail pane is shown.
///
/// `tauri.conf.json` の `minWidth` / `minHeight` と同じ値。
/// ずれたら `minimums_match_the_window_configuration` が落ちる。
pub const MIN_WIDTH: f64 = 720.0;
pub const MIN_HEIGHT: f64 = 420.0;

/// Smallest window while the detail pane is hidden (docs/adr/0025-hide-detail-pane.md).
///
/// サイドバー 36px とツリーの最小幅 240px に、ブランチ名とインジケーターが
/// 並んで読める余裕を足した値。**保存と復元の下限もこれ。** 細く保存した
/// ウィンドウを戻せるようにする。
pub const COMPACT_MIN_WIDTH: f64 = 360.0;

/// Width limit for the current layout.
pub fn min_width(detail_open: bool) -> f64 {
    if detail_open {
        MIN_WIDTH
    } else {
        COMPACT_MIN_WIDTH
    }
}

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
        && window.width >= COMPACT_MIN_WIDTH
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
        let (overlap_width, overlap_height) = overlap(window, screen);
        overlap_width >= VISIBLE_WIDTH && overlap_height >= VISIBLE_HEIGHT
    })
}

/// How far the window and the screen overlap, horizontally and vertically.
///
/// 重ならない向きは 0 以下になる。
fn overlap(window: &WindowState, screen: &Screen) -> (f64, f64) {
    let width = (window.x + window.width).min(screen.x + screen.width) - window.x.max(screen.x);
    let height = (window.y + window.height).min(screen.y + screen.height) - window.y.max(screen.y);
    (width, height)
}

/// Geometry that makes room for the detail pane again, or `None` if it already fits.
///
/// ツリーの幅は `pane_width` で固定しているので、細いまま詳細ペインを出すと
/// 詳細ペインが幅 0 に潰れる。**720px まで広げる。**
/// 広げると載っている画面の右端からはみ出すなら、はみ出さない位置まで左へずらす。
/// ただし画面の左端より外には出さない。どの画面に載っているか分からないときは、
/// 広げるだけでずらさない (docs/adr/0025-hide-detail-pane.md)。
pub fn widened_for_detail(current: WindowState, screens: &[Screen]) -> Option<WindowState> {
    if current.width >= MIN_WIDTH {
        return None;
    }
    let mut widened = WindowState {
        width: MIN_WIDTH,
        ..current
    };
    let holding = screens
        .iter()
        .map(|screen| (screen, overlap(&current, screen)))
        .filter(|(_, (width, height))| *width > 0.0 && *height > 0.0)
        .max_by(|(_, a), (_, b)| (a.0 * a.1).total_cmp(&(b.0 * b.1)))
        .map(|(screen, _)| screen);
    if let Some(screen) = holding {
        let right = screen.x + screen.width;
        if widened.x + widened.width > right {
            widened.x = (right - widened.width).max(screen.x);
        }
    }
    Some(widened)
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

/// Geometry to restore at startup.
///
/// 保存が無い、値が使えない、画面の外になる、のどれかなら `None`。
/// **詳細ペインを出しているなら、細い値は広げてから戻す。** 表示に戻した直後に
/// 強制終了すると、古い細い幅と `detail_open: true` が一緒に残る
/// (docs/adr/0025-hide-detail-pane.md)。
/// **判断はここ 1 本。** `restore` に散らすと、`tauri::WebviewWindow` が要るせいで
/// テストが付かないまま条件が増える。
pub fn geometry_to_apply(
    saved: Option<WindowState>,
    screens: &[Screen],
    detail_open: bool,
) -> Option<WindowState> {
    saved
        .filter(is_usable)
        .filter(|window| is_on_screen(window, screens))
        .map(|window| {
            if detail_open {
                widened_for_detail(window, screens).unwrap_or(window)
            } else {
                window
            }
        })
}

/// What the window needs when the detail pane is shown or hidden.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DetailLayout {
    /// 広げた寸法と位置。`None` なら動かさない
    pub widen_to: Option<WindowState>,
    pub min_width: f64,
}

/// Decide how to adjust the window for the detail pane.
///
/// **判断はここ 1 本。** [`apply_detail_open`] はこれを当てるだけにして、
/// `tauri::WebviewWindow` が要る側に分岐を残さない。
pub fn detail_layout(open: bool, current: WindowState, screens: &[Screen]) -> DetailLayout {
    DetailLayout {
        widen_to: if open {
            widened_for_detail(current, screens)
        } else {
            None
        },
        min_width: min_width(open),
    }
}

/// Why the window could not be adjusted for the detail pane.
#[derive(Debug)]
pub enum WindowError {
    /// 位置と寸法が読めない。広げる先を決められない
    Geometry,
    Tauri(tauri::Error),
}

impl std::fmt::Display for WindowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Geometry => write!(f, "ウィンドウの位置と寸法を読めません"),
            Self::Tauri(error) => write!(f, "{error}"),
        }
    }
}

impl From<tauri::Error> for WindowError {
    fn from(error: tauri::Error) -> Self {
        Self::Tauri(error)
    }
}

/// Put the window back where it was. 戻せない値なら何もしない。
///
/// **幅の下限を先に決める。** 詳細ペインを隠して細く保存したウィンドウは、
/// `tauri.conf.json` の 720px の下限のままだと戻せない (docs/adr/0025-hide-detail-pane.md)。
pub fn restore<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    saved: Option<WindowState>,
    detail_open: bool,
) {
    // 起動の途中なので画面に出す先が無い。**黙らずに stderr に残す**
    if let Err(error) = window.set_min_size(Some(tauri::LogicalSize::new(
        min_width(detail_open),
        MIN_HEIGHT,
    ))) {
        eprintln!("canopy: ウィンドウの幅の下限を決められません: {error}");
    }
    let Some(saved) = geometry_to_apply(saved, &screens(window), detail_open) else {
        return;
    };
    let _ = window.set_size(tauri::LogicalSize::new(saved.width, saved.height));
    let _ = window.set_position(tauri::LogicalPosition::new(saved.x, saved.y));
}

/// Change the width limit for the detail pane, widening the window when it comes back.
///
/// 当てるだけ。何をするかは [`detail_layout`] が決める (テストが付いている側)。
/// 位置と寸法を先に頼んでから下限を変える。どの順で効くかは OS 次第で、
/// 下限が先に効くと一瞬右へ広がってから戻ることがあるが、最後の位置と寸法は同じになる。
///
/// **位置と寸法が読めなくても下限は変える。** 変えないと、隠しても細くできない。
/// 読めなかったことは失敗として返す (呼び出し側がトーストに出す)。
pub fn apply_detail_open<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    open: bool,
) -> Result<(), WindowError> {
    let Some(current) = geometry(window) else {
        window.set_min_size(Some(tauri::LogicalSize::new(min_width(open), MIN_HEIGHT)))?;
        return Err(WindowError::Geometry);
    };
    let layout = detail_layout(open, current, &screens(window));
    if let Some(widened) = layout.widen_to {
        window.set_position(tauri::LogicalPosition::new(widened.x, widened.y))?;
        window.set_size(tauri::LogicalSize::new(widened.width, widened.height))?;
    }
    window.set_min_size(Some(tauri::LogicalSize::new(layout.min_width, MIN_HEIGHT)))?;
    Ok(())
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
        assert!(!is_usable(&window(0.0, 0.0, 359.0, 760.0)));
        assert!(!is_usable(&window(0.0, 0.0, 1180.0, 419.0)));
        assert!(!is_usable(&window(f64::NAN, 0.0, 1180.0, 760.0)));
        assert!(!is_usable(&window(0.0, f64::INFINITY, 1180.0, 760.0)));
    }

    /// 詳細ペインを隠している間は下限を 360px に下げる。出している間は 720px
    /// (docs/adr/0025-hide-detail-pane.md)
    #[test]
    fn lowers_the_minimum_width_while_the_detail_pane_is_hidden() {
        assert_eq!(min_width(true), 720.0);
        assert_eq!(min_width(false), 360.0);
    }

    /// 細く保存したウィンドウも戻せる。**隠している間の下限を下回るものは捨てる**
    #[test]
    fn accepts_a_narrow_window_saved_while_the_detail_pane_was_hidden() {
        assert!(is_usable(&window(120.0, 80.0, 360.0, 760.0)));
        assert!(!is_usable(&window(120.0, 80.0, 359.0, 760.0)));
    }

    /// 表示に戻すとき、720px より狭ければ 720px に広げる。
    /// 広げないと詳細ペインが幅 0 に潰れる (ツリーの幅は `pane_width` で固定)
    #[test]
    fn widens_a_narrow_window_when_the_detail_pane_comes_back() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert_eq!(
            widened_for_detail(window(100.0, 80.0, 400.0, 760.0), &screens),
            Some(window(100.0, 80.0, 720.0, 760.0))
        );
    }

    /// 広げると画面の右端からはみ出すなら、はみ出さない位置まで左へずらす
    #[test]
    fn shifts_left_to_stay_on_the_screen() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert_eq!(
            widened_for_detail(window(1100.0, 80.0, 400.0, 760.0), &screens),
            Some(window(792.0, 80.0, 720.0, 760.0))
        );
    }

    /// 載っている画面の右端で止める。隣の画面にまたがらせない
    #[test]
    fn stays_on_the_screen_the_window_is_on() {
        let screens = [
            screen(0.0, 0.0, 1512.0, 982.0),
            screen(1512.0, -300.0, 2560.0, 1440.0),
        ];

        // 1 枚目の右端の近く。2 枚目にはみ出させずに 1 枚目の中へずらす
        assert_eq!(
            widened_for_detail(window(1100.0, 80.0, 400.0, 760.0), &screens),
            Some(window(792.0, 80.0, 720.0, 760.0))
        );
        // 2 枚目の右端の近く
        assert_eq!(
            widened_for_detail(window(3800.0, 0.0, 400.0, 760.0), &screens),
            Some(window(3352.0, 0.0, 720.0, 760.0))
        );
    }

    /// 2 枚にまたがっているときは、多く重なっている方の画面を基準にする
    #[test]
    fn picks_the_screen_holding_most_of_the_window() {
        let screens = [
            screen(0.0, 0.0, 1512.0, 982.0),
            screen(1512.0, -300.0, 2560.0, 1440.0),
        ];

        // 1 枚目に 212px、2 枚目に 188px。1 枚目の右端で止める
        assert_eq!(
            widened_for_detail(window(1300.0, 80.0, 400.0, 760.0), &screens),
            Some(window(792.0, 80.0, 720.0, 760.0))
        );
        // 1 枚目に 62px、2 枚目に 338px。2 枚目の中なのでずらさない
        assert_eq!(
            widened_for_detail(window(1450.0, 80.0, 400.0, 760.0), &screens),
            Some(window(1450.0, 80.0, 720.0, 760.0))
        );
    }

    /// 画面が 720px より狭いなら、左端に揃える。左の外には出さない
    #[test]
    fn does_not_push_the_window_past_the_left_edge() {
        let screens = [screen(0.0, 0.0, 600.0, 900.0)];

        assert_eq!(
            widened_for_detail(window(200.0, 40.0, 400.0, 760.0), &screens),
            Some(window(0.0, 40.0, 720.0, 760.0))
        );
    }

    /// 既に 720px 以上あるなら動かさない
    #[test]
    fn leaves_a_wide_enough_window_alone() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert_eq!(
            widened_for_detail(window(100.0, 80.0, 720.0, 760.0), &screens),
            None
        );
        assert_eq!(
            widened_for_detail(window(100.0, 80.0, 1180.0, 760.0), &screens),
            None
        );
    }

    /// どの画面に載っているか分からないときは、広げるだけでずらさない
    #[test]
    fn only_widens_when_no_screen_holds_the_window() {
        assert_eq!(
            widened_for_detail(window(1100.0, 80.0, 400.0, 760.0), &[]),
            Some(window(1100.0, 80.0, 720.0, 760.0))
        );
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];
        assert_eq!(
            widened_for_detail(window(5000.0, 80.0, 400.0, 760.0), &screens),
            Some(window(5000.0, 80.0, 720.0, 760.0))
        );
        // 横は重なっていても、縦にどの画面にも載っていない
        assert_eq!(
            widened_for_detail(window(1100.0, 2000.0, 400.0, 760.0), &screens),
            Some(window(1100.0, 2000.0, 720.0, 760.0))
        );
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

        assert_eq!(geometry_to_apply(Some(good), &screens, true), Some(good));
        // 保存が無い
        assert_eq!(geometry_to_apply(None, &screens, true), None);
        // 隠した瞬間の 0 サイズ
        assert_eq!(
            geometry_to_apply(Some(window(0.0, 0.0, 0.0, 0.0)), &screens, true),
            None
        );
        // 外した外部ディスプレイの位置
        assert_eq!(
            geometry_to_apply(Some(window(2000.0, 200.0, 1180.0, 760.0)), &screens, true),
            None
        );
    }

    /// 詳細ペインを隠して細く保存したウィンドウは、細いまま戻す
    /// (docs/adr/0025-hide-detail-pane.md)
    #[test]
    fn restores_a_narrow_window_while_the_detail_pane_is_hidden() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];
        let narrow = window(120.0, 80.0, 360.0, 760.0);

        assert_eq!(
            geometry_to_apply(Some(narrow), &screens, false),
            Some(narrow)
        );
    }

    /// 詳細ペインを出しているのに細い値が残っていたら、戻すときに広げる。
    /// 開いた直後に強制終了すると、古い幅と `detail_open: true` が一緒に残る
    #[test]
    fn widens_a_narrow_window_restored_with_the_detail_pane_shown() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert_eq!(
            geometry_to_apply(Some(window(120.0, 80.0, 400.0, 760.0)), &screens, true),
            Some(window(120.0, 80.0, 720.0, 760.0))
        );
        // 右端の近くなら、広げたぶん左へずらす
        assert_eq!(
            geometry_to_apply(Some(window(1100.0, 80.0, 400.0, 760.0)), &screens, true),
            Some(window(792.0, 80.0, 720.0, 760.0))
        );
    }

    /// 表示に戻すときは広げて下限を 720px にする。隠すときは動かさずに下限を 360px にする
    #[test]
    fn lays_out_the_window_for_the_detail_pane() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];
        let narrow = window(1100.0, 80.0, 400.0, 760.0);

        assert_eq!(
            detail_layout(true, narrow, &screens),
            DetailLayout {
                widen_to: Some(window(792.0, 80.0, 720.0, 760.0)),
                min_width: 720.0,
            }
        );
        assert_eq!(
            detail_layout(false, narrow, &screens),
            DetailLayout {
                widen_to: None,
                min_width: 360.0,
            }
        );
    }

    /// 広いウィンドウで表示に戻すときは、下限だけ上げる
    #[test]
    fn only_raises_the_limit_when_the_window_is_wide_enough() {
        let screens = [screen(0.0, 0.0, 1512.0, 982.0)];

        assert_eq!(
            detail_layout(true, window(100.0, 80.0, 1180.0, 760.0), &screens),
            DetailLayout {
                widen_to: None,
                min_width: 720.0,
            }
        );
    }

    /// 画面の一覧が引けないときは動かさない
    #[test]
    fn leaves_the_window_alone_when_no_screen_is_known() {
        assert!(is_on_screen(&window(9000.0, 9000.0, 1180.0, 760.0), &[]));
    }
}
