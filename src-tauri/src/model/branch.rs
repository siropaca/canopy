use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A local branch.
///
/// `behind` / `ahead` treat 0 as "do not show"; null and 0 are not distinguished
/// (docs/specs/data-model.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Branch {
    /// Full name, e.g. `feature/rec-482`.
    pub name: String,
    /// Whether this is the HEAD of the registered worktree.
    pub is_current: bool,
    /// Commits to take in from the upstream branch.
    pub behind: u32,
    /// Commits to send to the upstream branch.
    pub ahead: u32,
    /// Name of the upstream branch. `None` when it is not configured.
    ///
    /// **`None` (未設定) と `upstream_gone` (設定済みだが消えた) は別の状態。**
    /// プッシュのコマンドが変わる (docs/specs/data-model.md)。
    pub upstream: Option<String>,
    /// Whether the configured upstream branch is gone.
    pub upstream_gone: bool,
    /// Unix milliseconds of the last commit.
    pub committed_at: i64,
    /// Path of the other worktree this branch is checked out in, if any.
    pub worktree_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    /// TypeScript の宣言に無いキーを JSON に出さない
    /// (docs/adr/0013-type-generation.md)。
    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&sample());
    }

    /// 追跡が未設定なら `upstream` は null になる。
    /// `origin/<ブランチ名>` と決め打ちしない (docs/specs/data-model.md)。
    #[test]
    fn serializes_a_missing_upstream_as_null() {
        let branch = Branch {
            upstream: None,
            ..sample()
        };

        let json = serde_json::to_value(&branch).expect("Branch should serialize");

        assert_eq!(json["upstream"], serde_json::Value::Null);
        assert_eq!(json["upstream_gone"], serde_json::json!(false));
    }

    fn sample() -> Branch {
        Branch {
            name: "feature/rec-482".to_owned(),
            is_current: true,
            behind: 3,
            ahead: 1,
            upstream: Some("origin/feature/rec-482".to_owned()),
            upstream_gone: false,
            committed_at: 1_755_000_000_000,
            worktree_path: None,
        }
    }
}
