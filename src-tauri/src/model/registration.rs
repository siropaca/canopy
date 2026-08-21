use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A registered repository, before its state has been read.
///
/// 起動直後はこれだけで見出しを描く。中身は届いた分から埋める
/// (docs/specs/ui.md の「読み込み中とエラー」)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RepoRegistration {
    pub id: String,
    /// Directory name at registration time.
    pub name: String,
    /// Absolute path, for display and copying.
    pub path: String,
}

/// Result of the "add a repository" flow.
///
/// スナップショットは含めない。登録したあとフロントが `get_repo_snapshot` を
/// 呼ぶ経路にすると、起動時の読み込みと同じ道を通る。
///
/// フォルダ選択のキャンセルと、リポジトリではない / 登録済みだった場合を分ける。
/// どれも `Err` ではない。**呼び出しが失敗したわけではない**ので、
/// フロントが理由を読んで扱えるようにする。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum AddRepoOutcome {
    Added {
        repo: RepoRegistration,
    },
    /// The folder picker was dismissed.
    Cancelled,
    /// The folder is not a repository, or is already registered.
    Rejected {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;

    #[test]
    fn ts_declaration_has_every_serde_key() {
        assert_serde_keys_match_ts(&RepoRegistration {
            id: "r1".to_owned(),
            name: "canopy".to_owned(),
            path: "/Users/dev/Projects/canopy".to_owned(),
        });
    }

    /// `kind` で分かれる形にする。フロントの分岐がタグ 1 つで書ける
    #[test]
    fn tags_the_outcome_with_a_kind() {
        assert_eq!(
            serde_json::to_value(AddRepoOutcome::Cancelled).expect("should serialize"),
            serde_json::json!({ "kind": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(AddRepoOutcome::Rejected {
                message: "登録済みです".to_owned()
            })
            .expect("should serialize"),
            serde_json::json!({ "kind": "rejected", "message": "登録済みです" })
        );
    }
}
