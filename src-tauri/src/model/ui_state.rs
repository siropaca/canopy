use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Initial width of the tree pane. Resizable between 240 and 760
/// (docs/design-system.md).
pub const DEFAULT_PANE_WIDTH: u32 = 360;

/// Position and size of the window. Restored because the app stays resident
/// (docs/adr/0011-residency.md).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// UI state that survives a restart (docs/specs/data-model.md).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UiState {
    /// Repository order, as ids.
    pub repo_order: Vec<String>,
    /// Keys of the nodes that are **open**.
    ///
    /// 折りたたんでいるキーではない。既定はリモートとタグが閉なので、
    /// 閉じているキーを保存すると初期状態でも数百件になる
    /// (docs/specs/data-model.md)。
    pub expanded: Vec<String>,
    pub pane_width: u32,
    pub console_open: bool,
    /// `None` until the window has been moved or resized (filled in phase 4).
    pub window: Option<WindowState>,
    pub group_directories: bool,
    pub local_only: bool,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            repo_order: Vec::new(),
            expanded: Vec::new(),
            pane_width: DEFAULT_PANE_WIDTH,
            console_open: false,
            window: None,
            // グループ化は既定オン、ローカルのみ表示は既定オフ (docs/specs/ui.md)
            group_directories: true,
            local_only: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&UiState::default());
        assert_serde_keys_match_ts(&WindowState {
            x: 0.0,
            y: 0.0,
            width: 1180.0,
            height: 760.0,
        });
    }

    /// 既定はサイドバーの表示に合わせる。グループ化オン、ローカルのみ表示オフ
    /// (docs/specs/ui.md の「サイドバー」)。
    #[test]
    fn defaults_match_the_sidebar_toggles() {
        let state = UiState::default();

        assert!(state.group_directories);
        assert!(!state.local_only);
        assert_eq!(state.pane_width, 360);
    }
}
