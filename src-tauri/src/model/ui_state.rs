use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// Initial width of the tree pane. Resizable between 240 and 760
/// (docs/design-system.md).
pub const DEFAULT_PANE_WIDTH: u32 = 360;

/// Position and size of the window. Restored because the app stays resident
/// (docs/adr/0011-residency.md).
///
/// **フロントには渡さない。** 位置とサイズを知っているのは Rust 側だけなので、
/// 共有する DTO に混ぜると「どちらにも流れないフィールド」になる
/// (docs/specs/data-model.md の「設定ファイル」)。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// UI state that survives a restart (docs/specs/data-model.md).
///
/// **足りない項目は既定値で埋める** (`serde(default)`)。保存する項目が増えるたびに
/// 前の版で書いた設定ファイルが「壊れている」と判定されると、登録したリポジトリごと
/// 読めなくなる (docs/adr/0016-store-without-plugin.md)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
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
    pub group_directories: bool,
    pub local_only: bool,
    /// Whether the detail pane is shown (docs/adr/0025-hide-detail-pane.md).
    ///
    /// ウィンドウの幅の下限もこれで決まる。起動時は Rust がこの値を読んでから
    /// 位置とサイズを戻す。
    pub detail_open: bool,
    /// Heading colour per repository id (docs/adr/0024-repo-heading-color.md).
    ///
    /// 色を付けていないリポジトリは入れない。
    pub repo_colors: RepoColors,
}

/// Colour a repository heading can be painted with.
///
/// 値はトークン (`--head-<名前>`) に置き、ここでは名前だけを持つ
/// (docs/design-system.md の「見出しの色」)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RepoColor {
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
}

/// Heading colour per repository id.
///
/// **知らない色の名前は読み捨てる。** 新しい版で色を増やしたあと古い版で開いても、
/// 設定ファイル全体を壊れた扱いにしない (docs/adr/0016-store-without-plugin.md)。
//
// そのために `Deserialize` を手で書いている。`deserialize_with` は ts-rs が
// 解釈できずに警告を出す (この事情は生成物の JSDoc に出さない)。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
pub struct RepoColors(BTreeMap<String, RepoColor>);

impl From<BTreeMap<String, RepoColor>> for RepoColors {
    fn from(colours: BTreeMap<String, RepoColor>) -> Self {
        Self(colours)
    }
}

impl std::ops::Deref for RepoColors {
    type Target = BTreeMap<String, RepoColor>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for RepoColors {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// A colour entry as it appears in the file, before unknown names are dropped.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredColour {
    Known(RepoColor),
    Unknown(serde::de::IgnoredAny),
}

impl<'de> Deserialize<'de> for RepoColors {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let stored = BTreeMap::<String, StoredColour>::deserialize(deserializer)?;
        Ok(Self(
            stored
                .into_iter()
                .filter_map(|(id, colour)| match colour {
                    StoredColour::Known(colour) => Some((id, colour)),
                    StoredColour::Unknown(_) => None,
                })
                .collect(),
        ))
    }
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            repo_order: Vec::new(),
            expanded: Vec::new(),
            pane_width: DEFAULT_PANE_WIDTH,
            console_open: false,
            // グループ化は既定オン、ローカルのみ表示は既定オフ (docs/specs/ui.md)
            group_directories: true,
            local_only: false,
            // 詳細パネルは既定で表示 (docs/specs/ui.md の「サイドバー」)
            detail_open: true,
            repo_colors: RepoColors::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&UiState::default());
    }

    /// ウィンドウの位置とサイズはフロントと共有しない。
    ///
    /// 共有すると「フロントが送っても捨てられる」フィールドになり、
    /// フロントからウィンドウを動かす機能を足したときに無言で効かなくなる
    #[test]
    fn does_not_share_the_window_geometry_with_the_frontend() {
        let keys = serde_json::to_value(UiState::default()).expect("UiState should serialize");
        let object = keys.as_object().expect("UiState is an object");

        assert!(!object.contains_key("window"), "{object:?}");
    }

    /// 既定はサイドバーの表示に合わせる。グループ化オン、ローカルのみ表示オフ、
    /// 詳細パネルは表示 (docs/specs/ui.md の「サイドバー」)。
    #[test]
    fn defaults_match_the_sidebar_toggles() {
        let state = UiState::default();

        assert!(state.group_directories);
        assert!(!state.local_only);
        assert!(state.detail_open);
        assert_eq!(state.pane_width, 360);
        assert!(state.repo_colors.is_empty());
    }

    /// 見出しの色は名前で持つ。hex で持つとトークンを直したときに追従しない
    /// (docs/adr/0024-repo-heading-color.md)
    #[test]
    fn stores_heading_colours_by_name() {
        let mut state = UiState::default();
        for (id, colour) in [
            ("r1", RepoColor::Red),
            ("r2", RepoColor::Orange),
            ("r3", RepoColor::Yellow),
            ("r4", RepoColor::Green),
            ("r5", RepoColor::Blue),
            ("r6", RepoColor::Purple),
        ] {
            state.repo_colors.insert(id.to_owned(), colour);
        }

        let json = serde_json::to_value(&state).expect("UiState should serialize");

        assert_eq!(
            json["repo_colors"],
            serde_json::json!({
                "r1": "red", "r2": "orange", "r3": "yellow",
                "r4": "green", "r5": "blue", "r6": "purple",
            })
        );
    }

    /// 生成した TypeScript も同じ 6 色を宣言している。フロントの色の一覧は
    /// この型で縛っている (src/shared/lib/repoColors.ts)
    #[test]
    fn ts_declaration_lists_every_colour() {
        let declaration = <RepoColor as ts_rs::TS>::decl(&ts_rs::Config::default());

        for name in ["red", "orange", "yellow", "green", "blue", "purple"] {
            assert!(
                declaration.contains(&format!("\"{name}\"")),
                "{declaration}"
            );
        }
    }

    /// 知らない色の名前は読み捨てる。**設定ファイル全体を壊れた扱いにしない。**
    /// 新しい版で色を増やしたあと、古い版で開いても登録が消えない
    /// (docs/adr/0016-store-without-plugin.md)
    #[test]
    fn drops_a_colour_it_does_not_know() {
        let state: UiState = serde_json::from_value(serde_json::json!({
            "repo_colors": { "r1": "pink", "r2": "green", "r3": 3, "r4": null },
        }))
        .expect("an unknown colour should not fail the whole file");

        assert_eq!(
            *state.repo_colors,
            BTreeMap::from([("r2".to_owned(), RepoColor::Green)])
        );
    }

    /// 色と詳細パネルが無い、前の版の設定ファイルも読める
    #[test]
    fn reads_a_file_written_before_the_colours_and_the_detail_toggle() {
        let state: UiState = serde_json::from_value(serde_json::json!({
            "repo_order": ["r1"],
            "expanded": [],
            "pane_width": 420,
            "console_open": false,
            "group_directories": true,
            "local_only": false,
        }))
        .expect("an older file should still load");

        assert!(state.detail_open);
        assert!(state.repo_colors.is_empty());
        assert_eq!(state.pane_width, 420);
    }

    /// 詳細パネルを隠した状態を保存して読み戻せる
    #[test]
    fn round_trips_a_hidden_detail_pane() {
        let state = UiState {
            detail_open: false,
            ..UiState::default()
        };

        let json = serde_json::to_value(&state).expect("UiState should serialize");
        let back: UiState = serde_json::from_value(json.clone()).expect("should read back");

        assert_eq!(json["detail_open"], serde_json::json!(false));
        assert!(!back.detail_open);
    }
}
