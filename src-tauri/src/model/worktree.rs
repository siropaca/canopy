use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeList;

/// A worktree other than the registered one.
///
/// 未コミットはワークツリー単位で持つ。リポジトリ単位にまとめると、
/// ワークツリーで作業中の変更が別のブランチの表示に混ざる
/// (docs/specs/data-model.md)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Worktree {
    /// Branch checked out in this worktree.
    pub branch: String,
    pub path: String,
    /// Uncommitted changes **of this worktree**.
    pub changes: ChangeList,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&Worktree {
            branch: "dev/rec-501".to_owned(),
            path: "/Users/dev/worktrees/rec-501".to_owned(),
            changes: ChangeList {
                items: Vec::new(),
                total: 0,
            },
        });
    }
}
