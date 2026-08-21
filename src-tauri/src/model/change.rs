use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single uncommitted change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Change {
    /// `M` / `A` / `D` / `R` / `??`
    pub status: String,
    /// Path relative to the repository root.
    pub path: String,
}

/// Uncommitted changes of one worktree.
///
/// `items` is capped on the Rust side; `total` carries the real count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangeList {
    pub items: Vec<Change>,
    pub total: u32,
}

impl ChangeList {
    /// How many items ride along on the IPC.
    ///
    /// UI は 20 件しか出さないので 21 件に切って総数を別に渡す。
    /// `.gitignore` を整える前のリポジトリでは `git status` が数千行返る
    /// (docs/specs/data-model.md)。
    pub const MAX_ITEMS: usize = 21;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    /// JSON のキーが TypeScript の宣言に無いとずれる。
    /// `#[ts(rename_all)]` を単独で足すと serde だけ snake_case のまま残り、
    /// 型は `originUrl` と言うのに実行時は `origin_url` になる
    /// (docs/adr/0013-type-generation.md)。
    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&sample());
        assert_serde_keys_match_ts(&sample().items.remove(0));
    }

    /// フィールド名は Rust の snake_case のまま JSON に出る。
    /// データモデルの表がそのまま IPC の形になっていることを固定する
    /// (docs/specs/data-model.md)。
    #[test]
    fn serializes_field_names_as_declared() {
        let list = sample();

        let json = serde_json::to_value(&list).expect("ChangeList should serialize");

        assert_eq!(
            json,
            serde_json::json!({
                "items": [{ "status": "??", "path": "src/main.rs" }],
                "total": 1
            })
        );
    }

    /// UI は 20 件しか出さないので 21 件に切る。
    /// **フロントの `FILE_LIMIT` (20) + 1 と揃える。**
    /// ずれると `他 n 件` の n が実際と合わなくなる (docs/specs/data-model.md)
    #[test]
    fn caps_items_one_above_what_the_ui_shows() {
        assert_eq!(ChangeList::MAX_ITEMS, 21);
    }

    fn sample() -> ChangeList {
        ChangeList {
            items: vec![Change {
                status: "??".to_owned(),
                path: "src/main.rs".to_owned(),
            }],
            total: 1,
        }
    }
}
