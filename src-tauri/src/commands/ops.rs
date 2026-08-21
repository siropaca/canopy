use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use super::CommandError;
use crate::git::Operation;
use crate::model::{CommandResult, OpOutcome, PushPreview, RepoUpdate};
use crate::ops;
use crate::state::AppState;

/*
 * 書き込みと補助操作。
 *
 * **中身は薄くする。** locate → ロック → 実行 → 取り直しの順序は `crate::ops`
 * が 1 箇所で持っている (docs/adr/0009-concurrency-and-refresh.md)。
 * 参照名の検証も `crate::git` の中で必ず通る (docs/security.md)。
 */

/// Event that carries one repository's state after a bulk fetch.
///
/// 一括フェッチは 1 本の invoke で返さない。返ってきた順に差し替える
/// (docs/adr/0009-concurrency-and-refresh.md の「一括フェッチ」)。
pub const REPO_SNAPSHOT_UPDATED: &str = "repo_snapshot_updated";

#[tauri::command(rename_all = "snake_case")]
pub async fn fetch_repo(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::Fetch).await?)
}

/// Fetch every registered repository. 結果はイベントで返す。
///
/// 戻り値は「これから取りに行く id」。フロントはこれで実行中の表示を出して、
/// `repo_snapshot_updated` が届いた分から差し替える。
#[tauri::command(rename_all = "snake_case")]
pub async fn fetch_all<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, CommandError> {
    let ids: Vec<String> = state
        .read(|registry| registry.registrations())
        .await?
        .into_iter()
        .map(|repo| repo.id)
        .collect();

    for repo_id in ids.clone() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            let update = match ops::fetch_in_bulk(&state, &repo_id).await {
                Ok(outcome) => RepoUpdate::done(repo_id, outcome),
                Err(error) => RepoUpdate::failed(repo_id, error.to_string()),
            };
            if let Err(error) = app.emit(REPO_SNAPSHOT_UPDATED, update) {
                // 送れなかったら画面が更新されないので、黙って捨てない
                eprintln!("canopy: {REPO_SNAPSHOT_UPDATED} を送れませんでした: {error}");
            }
        });
    }
    Ok(ids)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pull_current(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::PullCurrent).await?)
}

/// Fast-forward a branch without checking it out.
///
/// **現在ブランチのプルとは別物。** 早送りできないときは失敗する
/// (docs/specs/git-operations.md の「他のローカルブランチのプルは早送り限定」)。
#[tauri::command(rename_all = "snake_case")]
pub async fn fast_forward_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::FastForward { branch }).await?)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::Checkout { name }).await?)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkout_tag(
    state: State<'_, AppState>,
    repo_id: String,
    tag: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::CheckoutTag { tag }).await?)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkout_and_pull(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::CheckoutAndPull { name }).await?)
}

/// Go back to the branch before this one. detached HEAD から戻る手段。
#[tauri::command(rename_all = "snake_case")]
pub async fn checkout_previous(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(&state, &repo_id, &Operation::Previous).await?)
}

/// Push a branch. `force_with_lease` に sha があれば強制プッシュ。
///
/// **sha はフロントがダイアログで見せていた値。** 値なしの
/// `--force-with-lease` はフェッチした直後に無意味になる
/// (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)。
#[tauri::command(rename_all = "snake_case")]
pub async fn push_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    force_with_lease: Option<String>,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(
        &state,
        &repo_id,
        &Operation::Push {
            branch,
            force_with_lease,
        },
    )
    .await?)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn rename_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    new_name: String,
) -> Result<OpOutcome, CommandError> {
    Ok(ops::run(
        &state,
        &repo_id,
        &Operation::Rename {
            from: name,
            to: new_name,
        },
    )
    .await?)
}

/// What the push dialog needs. スナップショットには載せない。
#[tauri::command(rename_all = "snake_case")]
pub async fn get_push_preview(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
) -> Result<PushPreview, CommandError> {
    Ok(ops::read_push_preview(&state, &repo_id, &branch).await?)
}

/// Show the repository in Finder. git を実行しないが、結果の形は揃える。
#[tauri::command(rename_all = "snake_case")]
pub async fn reveal_in_finder(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<CommandResult, CommandError> {
    Ok(ops::reveal(&state, &repo_id).await?)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn open_in_terminal(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<CommandResult, CommandError> {
    Ok(ops::open_terminal(&state, &repo_id).await?)
}
