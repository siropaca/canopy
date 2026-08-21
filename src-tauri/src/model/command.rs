use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::RepoSnapshot;

/// One git run, as the console shows it.
///
/// 操作は 1 コマンドで終わらない。名前の変更は `branch -m` と
/// `branch --unset-upstream`、チェックアウトとプルは `switch` と `pull` の
/// 2 本になる (docs/specs/git-operations.md)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandStep {
    /// The command line as the user would type it.
    pub command: String,
    /// `None` when git was killed by a signal or the deadline.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// How an operation ended.
///
/// **`ok` だけでは足りない。** 「同じ操作を実行中なので省略した」は失敗では
/// ないので赤いトーストに出してはいけないし、コピーや `open` はコンソールに
/// 出す段を持たない。`steps` が空かどうかで見分けると、省略とアプリ側の異常が
/// 同居する (docs/adr/0018-command-result-steps.md)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ResultKind {
    /// git を実行した。`steps` に段が入る
    Ran,
    /// 同じ操作が走っていたので実行しなかった。**失敗ではない**
    Skipped,
    /// git を実行しない操作 (コピー、Finder で表示、ターミナルで開く)
    Direct,
}

/// What an operation did.
///
/// git の非ゼロ終了は失敗ではなく結果として返す
/// (docs/adr/0009-concurrency-and-refresh.md)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandResult {
    /// How it ended. 見せ方はこれで決める。
    pub kind: ResultKind,
    /// Whether the operation achieved what was asked.
    ///
    /// `kind` が `skipped` のときは何も起きていないので `false`。
    /// **色と種別は `kind` で決める。** `ok` だけを見ると省略が失敗に見える。
    pub ok: bool,
    /// 実行したコマンドを順に。**失敗しても出力を捨てない**
    ///
    /// `kind` が `ran` 以外なら空。
    pub steps: Vec<CommandStep>,
    /// One line for a person. 失敗の理由、または成功しても伝えるべきこと。
    pub message: Option<String>,
}

impl CommandResult {
    /// git を実行した結果。
    pub fn ran(steps: Vec<CommandStep>, ok: bool, message: Option<String>) -> Self {
        Self {
            kind: ResultKind::Ran,
            ok,
            steps,
            message,
        }
    }

    /// 同じ操作が走っていたので実行しなかった。
    pub fn skipped(message: impl Into<String>) -> Self {
        Self {
            kind: ResultKind::Skipped,
            ok: false,
            steps: Vec::new(),
            message: Some(message.into()),
        }
    }

    /// git を実行しない操作の結果。
    pub fn direct(ok: bool, message: impl Into<String>) -> Self {
        Self {
            kind: ResultKind::Direct,
            ok,
            steps: Vec::new(),
            message: Some(message.into()),
        }
    }
}

/// What an operation command returns.
///
/// **フロントが「操作」と「取り直し」で 2 回 invoke する形にしない**
/// (docs/specs/data-model.md の「コマンドの返し方」)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpOutcome {
    pub result: CommandResult,
    /// **成否に関係なく**取り直した状態。
    ///
    /// `None` は取り直しに失敗したとき (実行中にディレクトリが消えた、
    /// index が壊れた)。**それでも `result` は返す。**
    /// `Err` で返すと Tauri は 1 値しか運べないので、実行し終えた git の
    /// stdout / stderr が消える (docs/adr/0009-concurrency-and-refresh.md)。
    pub snapshot: Option<RepoSnapshot>,
    /// 取り直しに失敗した理由。
    pub snapshot_error: Option<String>,
}

impl OpOutcome {
    pub fn new(result: CommandResult, snapshot: RepoSnapshot) -> Self {
        Self {
            result,
            snapshot: Some(snapshot),
            snapshot_error: None,
        }
    }

    /// 実行はできたが、状態を読み直せなかった。
    pub fn without_snapshot(result: CommandResult, reason: String) -> Self {
        Self {
            result,
            snapshot: None,
            snapshot_error: Some(reason),
        }
    }
}

/// One repository's state after a bulk fetch. `repo_snapshot_updated` の中身。
///
/// 状態そのものが読めなかったリポジトリも落とさずに知らせる。
/// 落とすと「フェッチしたのに何も起きない」リポジトリができる。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RepoUpdate {
    pub repo_id: String,
    /// `None` はアプリ側の異常 (ディレクトリが消えている、設定が読めない)。
    pub outcome: Option<OpOutcome>,
    /// `outcome` が `None` のときの理由。
    pub error: Option<String>,
}

impl RepoUpdate {
    pub fn done(repo_id: String, outcome: OpOutcome) -> Self {
        Self {
            repo_id,
            outcome: Some(outcome),
            error: None,
        }
    }

    pub fn failed(repo_id: String, error: String) -> Self {
        Self {
            repo_id,
            outcome: None,
            error: Some(error),
        }
    }
}

/// One commit, for the push dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Commit {
    /// Abbreviated hash.
    pub hash: String,
    pub subject: String,
}

/// What the push dialog needs.
///
/// スナップショットには載せない。載せると取り直すたびに全ローカルブランチ分の
/// `git log` が走る (docs/specs/data-model.md の `Branch`)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PushPreview {
    pub branch: String,
    /// Remote the push would go to. 追跡先が無ければ `origin`。
    pub remote: String,
    /// Branch name **on the remote**. 追跡先が無ければローカルと同じ名前。
    ///
    /// フロントが `upstream` から切り出さないために持たせる。
    /// 切り出すと、リモート名にスラッシュが無いことを前提にした処理が増える。
    pub remote_branch: String,
    /// Upstream branch, as `origin/main`. `None` when it is not configured.
    pub upstream: Option<String>,
    /// Sha of the upstream ref **at the moment the dialog opened**.
    ///
    /// 強制プッシュの `--force-with-lease=<名前>:<sha>` に渡す。値なしの
    /// `--force-with-lease` は手元の追跡 ref を基準にするので、フェッチした直後は
    /// 無意味になる (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)。
    pub remote_sha: Option<String>,
    /// Commits this push would send.
    pub ahead: Vec<Commit>,
    /// Commits a force push would drop. ahead と behind の両方があるときに見せる。
    pub behind: Vec<Commit>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::assert_serde_keys_match_ts;
    use crate::model::{ChangeList, Head};

    #[test]
    fn ts_declaration_has_every_serde_key() {
        let step = CommandStep {
            command: "git push origin main".to_owned(),
            code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_serde_keys_match_ts(&step);
        let result = CommandResult::ran(vec![step], true, None);
        assert_serde_keys_match_ts(&result);
        assert_serde_keys_match_ts(&OpOutcome::new(
            result,
            RepoSnapshot {
                id: "r1".to_owned(),
                name: "canopy".to_owned(),
                path: "/Users/dev/canopy".to_owned(),
                origin_url: None,
                local: Vec::new(),
                remote: Vec::new(),
                tags: Vec::new(),
                worktrees: Vec::new(),
                changes: ChangeList {
                    items: Vec::new(),
                    total: 0,
                },
                fetched_at: None,
                revision: 2,
                head: Head::branch("main"),
            },
        ));
        assert_serde_keys_match_ts(&RepoUpdate::failed(
            "r1".to_owned(),
            "ディレクトリが見つかりません".to_owned(),
        ));
        assert_serde_keys_match_ts(&Commit {
            hash: "9f3c1ab".to_owned(),
            subject: "feat: 追加".to_owned(),
        });
        assert_serde_keys_match_ts(&PushPreview {
            branch: "main".to_owned(),
            remote: "origin".to_owned(),
            remote_branch: "main".to_owned(),
            upstream: Some("origin/main".to_owned()),
            remote_sha: Some("9f3c1ab".to_owned()),
            ahead: Vec::new(),
            behind: Vec::new(),
        });
    }

    /// **取り直しに失敗しても、実行した git の出力は返す。**
    /// `Err` にすると stdout / stderr が消える
    #[test]
    fn keeps_the_output_when_the_snapshot_cannot_be_read() {
        let outcome = OpOutcome::without_snapshot(
            CommandResult::ran(Vec::new(), true, None),
            "ディレクトリが見つかりません".to_owned(),
        );

        assert!(outcome.result.ok);
        assert!(outcome.snapshot.is_none());
        assert_eq!(
            outcome.snapshot_error.as_deref(),
            Some("ディレクトリが見つかりません")
        );
    }

    /// 実行しなかった操作も理由を返す。黙って何も起きない状態にしない
    #[test]
    fn a_skipped_operation_carries_its_reason() {
        let result = CommandResult::skipped("同じ操作を実行中です");

        assert_eq!(result.kind, ResultKind::Skipped);
        assert!(!result.ok);
        assert!(result.steps.is_empty());
        assert_eq!(result.message.as_deref(), Some("同じ操作を実行中です"));
    }

    /// **省略と失敗を見分けられる。** 見分けられないと、フェーズ 3 のトーストが
    /// 「同じ操作を実行中です」を赤いエラーとして出すしかなくなる
    #[test]
    fn tells_the_three_endings_apart() {
        let ran = CommandResult::ran(Vec::new(), false, Some("失敗".to_owned()));
        let skipped = CommandResult::skipped("実行中");
        let direct = CommandResult::direct(true, "コピーしました");

        assert_eq!(ran.kind, ResultKind::Ran);
        assert_eq!(skipped.kind, ResultKind::Skipped);
        assert_eq!(direct.kind, ResultKind::Direct);
        // 段を持つのは git を実行したときだけ
        assert!(skipped.steps.is_empty());
        assert!(direct.steps.is_empty());
    }

    /// `kind` は小文字。TypeScript の型と実行時の値がずれると分岐が全部 false になる
    #[test]
    fn serializes_the_kind_in_lower_case() {
        let json = serde_json::to_value(CommandResult::skipped("実行中")).expect("serialize");

        assert_eq!(json["kind"], serde_json::json!("skipped"));
    }
}
