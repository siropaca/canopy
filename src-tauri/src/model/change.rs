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
