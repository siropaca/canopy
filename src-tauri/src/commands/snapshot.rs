use tauri::State;

use super::CommandError;
use crate::model::RepoSnapshot;
use crate::ops;
use crate::state::AppState;

/// Read one repository's state.
///
/// 失敗はこのリポジトリだけの `Err` にする。1 つの取得失敗で全体を落とさない
/// (docs/specs/data-model.md の `RepoState`)。
#[tauri::command(rename_all = "snake_case")]
pub async fn get_repo_snapshot(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<RepoSnapshot, CommandError> {
    Ok(ops::read_snapshot(&state, &repo_id).await?)
}
