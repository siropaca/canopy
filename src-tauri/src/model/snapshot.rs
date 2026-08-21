use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Branch, ChangeList, Head, Ref, Worktree};

/// Everything the frontend draws for one repository.
///
/// git の状態をフロントで再計算しない (docs/specs/data-model.md)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RepoSnapshot {
    /// Identifier inside the app. Keeps paths out of command arguments.
    pub id: String,
    /// Display name. The directory name.
    pub name: String,
    /// Absolute path. Passed to the frontend for display and copying only.
    pub path: String,
    /// `origin` URL normalised to https form.
    pub origin_url: Option<String>,
    pub local: Vec<Branch>,
    /// Remote-tracking branches, as short names such as `origin/develop`.
    pub remote: Vec<Ref>,
    pub tags: Vec<Ref>,
    /// Worktrees other than the registered one.
    pub worktrees: Vec<Worktree>,
    /// Uncommitted changes of the registered worktree.
    pub changes: ChangeList,
    /// Unix milliseconds of the last successful fetch.
    pub fetched_at: Option<i64>,
    /// Generation of this repository's snapshot. Monotonically increasing.
    ///
    /// フロントは自分が持っているものより古い `revision` を捨てる
    /// (docs/adr/0009-concurrency-and-refresh.md)。
    pub revision: u64,
    pub head: Head,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&RepoSnapshot {
            id: "r1".to_owned(),
            name: "canopy".to_owned(),
            path: "/Users/dev/Projects/canopy".to_owned(),
            origin_url: Some("https://github.com/acme/canopy".to_owned()),
            local: Vec::new(),
            remote: Vec::new(),
            tags: Vec::new(),
            worktrees: Vec::new(),
            changes: ChangeList {
                items: Vec::new(),
                total: 0,
            },
            fetched_at: None,
            revision: 1,
            head: Head::branch("main"),
        });
    }
}
