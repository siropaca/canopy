//! Composing one operation: locate, lock, run, take the snapshot again.
//!
//! **順序をここ 1 箇所に持つ。** コマンドごとに書くと、7 本のうち 1 本だけ
//! 取り直しをロックの外でやる、という壊れ方をする
//! (docs/adr/0009-concurrency-and-refresh.md の「状態の取り直し」)。
//!
//! `&AppState` を受ける関数にしてあるので、Tauri 無しでテストできる。

use std::fmt;

use crate::git::{self, GitError, Operation};
use crate::model::{CommandResult, OpOutcome, PushPreview, RepoSnapshot};
use crate::os::{self, OsError};
use crate::state::{AppState, Located, StateError};

/// Why an operation could not be carried out.
#[derive(Debug)]
pub enum OpError {
    State(StateError),
    Git(GitError),
}

impl fmt::Display for OpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::State(source) => write!(f, "{source}"),
            Self::Git(source) => write!(f, "{source}"),
        }
    }
}

impl std::error::Error for OpError {}

impl From<StateError> for OpError {
    fn from(source: StateError) -> Self {
        Self::State(source)
    }
}

impl From<GitError> for OpError {
    fn from(source: GitError) -> Self {
        Self::Git(source)
    }
}

/// Read one repository's state.
///
/// 順序は locate → 読み取りの枠 → **共有ロック** → 世代の採番 → 組み立て。
/// 共有ロックを取るのは、フェッチが refs を書き換えている途中で
/// `for-each-ref` を読ませないため (docs/adr/0009-concurrency-and-refresh.md)。
pub async fn read_snapshot(state: &AppState, repo_id: &str) -> Result<RepoSnapshot, OpError> {
    let located = state.locate(repo_id).await?;
    let _permit = state.queue().read_permit().await;
    let _shared = state.queue().read_lock(&located.common_dir).await;
    Ok(take_snapshot(state, repo_id, &located).await?)
}

/// Run one write operation and take the snapshot again.
///
/// 順序はこれで固定する。
///
/// 1. locate (id からパスを引く。**フロントから来たパスで git を実行しない**)
/// 2. 同種操作の重複排除
/// 3. ネットワークの枠 (**ロックの前に取る。** ロックを持って待つと、
///    一括フェッチ中に同じリポジトリのチェックアウトが待たされる)
/// 4. 書き込みロック
/// 5. 実行 (参照名の検証は `git::run_operation` の中)
/// 6. **同じロックの中で**取り直し
pub async fn run(state: &AppState, repo_id: &str, op: &Operation) -> Result<OpOutcome, OpError> {
    let located = state.locate(repo_id).await?;
    let kind = op.kind();

    let Some(_claim) = state.queue().try_claim(&located.common_dir, kind) else {
        // 積まずに、走っている操作が終わった状態を返す
        let _shared = state.queue().read_lock(&located.common_dir).await;
        return Ok(OpOutcome::new(
            CommandResult::skipped("同じ操作を実行中です"),
            take_snapshot(state, repo_id, &located).await?,
        ));
    };

    let _network = if kind.is_network() {
        Some(state.queue().network_permit().await)
    } else {
        None
    };
    let _exclusive = state.queue().write_lock(&located.common_dir).await;

    let result = git::run_operation(&located.dir, op).await?;
    // **成否に関係なく**取り直す。失敗時こそ状態がずれる。
    // 取り直しが失敗しても `result` は捨てない (実行した git の出力が消える)
    Ok(match take_snapshot(state, repo_id, &located).await {
        Ok(snapshot) => OpOutcome::new(result, snapshot),
        Err(error) => OpOutcome::without_snapshot(result, error.to_string()),
    })
}

/// Fetch one repository as part of a bulk fetch.
///
/// 一括フェッチは通常のネットワークの枠より小さい枠も通す。
/// 対話操作の枠を空けておくため (docs/adr/0009-concurrency-and-refresh.md)。
pub async fn fetch_in_bulk(state: &AppState, repo_id: &str) -> Result<OpOutcome, OpError> {
    let _bulk = state.queue().bulk_permit().await;
    run(state, repo_id, &Operation::Fetch).await
}

/// Show the repository in Finder.
///
/// git を実行しないので、ロックも枠も通らない。**結果の形は他の操作と揃える。**
/// 文言を Rust 側に置いておかないと、フェーズ 3 のコンソールとトーストが
/// 2 言語に分かれた文言を扱うことになる
/// (docs/adr/0015-auxiliary-operations.md)。
pub async fn reveal(state: &AppState, repo_id: &str) -> Result<CommandResult, OpError> {
    let located = state.locate(repo_id).await?;
    Ok(direct(
        os::reveal_in_finder(&located.dir).await,
        "Finder で表示しました",
    ))
}

/// Open the repository in the configured terminal application.
pub async fn open_terminal(state: &AppState, repo_id: &str) -> Result<CommandResult, OpError> {
    let located = state.locate(repo_id).await?;
    let app = state
        .read(|registry| registry.terminal_app().to_owned())
        .await?;
    Ok(direct(
        os::open_in_terminal(&located.dir, &app).await,
        "ターミナルで開きました",
    ))
}

/// Turn an `open` result into the shape every operation returns.
fn direct(outcome: Result<(), OsError>, done: &str) -> CommandResult {
    match outcome {
        Ok(()) => CommandResult::direct(true, done),
        // 握りつぶさない。理由をそのまま人に見せる
        Err(error) => CommandResult::direct(false, error.to_string()),
    }
}

/// Everything the push dialog needs. 読み取りなので共有ロック。
pub async fn read_push_preview(
    state: &AppState,
    repo_id: &str,
    branch: &str,
) -> Result<PushPreview, OpError> {
    let located = state.locate(repo_id).await?;
    let _permit = state.queue().read_permit().await;
    let _shared = state.queue().read_lock(&located.common_dir).await;
    Ok(git::push_preview(&located.dir, branch).await?)
}

/// Take the snapshot. 世代の採番も**ロックの中で**行う。
///
/// ロックの外で採番すると、後から始まった操作が小さい番号を持ち得る。
/// フロントは番号で古いものを捨てるので、新しい状態が捨てられる。
///
/// **読み取りの枠 (`READ_LIMIT`) は通さない。** 通すとロックを持ったまま枠を
/// 待つことになり、枠を埋めている読み取りがそのロックを待っていれば
/// そのリポジトリが完全に止まる。`READ_LIMIT` は「キューを通す読み取り
/// (`read_snapshot`) の上限」で、取り直しはその外にいる。
async fn take_snapshot(
    state: &AppState,
    repo_id: &str,
    located: &Located,
) -> Result<RepoSnapshot, GitError> {
    let revision = state.queue().next_revision(repo_id).await;
    git::build_snapshot(
        repo_id,
        &located.name,
        &located.dir,
        &located.common_dir,
        revision,
    )
    .await
}
