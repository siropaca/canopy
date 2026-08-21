use std::path::PathBuf;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use super::CommandError;
use crate::git::{build_snapshot, common_dir, toplevel};
use crate::model::{AddRepoOutcome, RepoRegistration, RepoSnapshot, UiState};
use crate::state::AppState;
use crate::store::RepoPath;

/// Registered repositories, in display order.
#[tauri::command(rename_all = "snake_case")]
pub async fn list_repos(state: State<'_, AppState>) -> Result<Vec<RepoRegistration>, CommandError> {
    Ok(state.read(|registry| registry.registrations()).await?)
}

/// Persisted UI state.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_ui_state(state: State<'_, AppState>) -> Result<UiState, CommandError> {
    Ok(state.read(|registry| registry.ui_state().clone()).await?)
}

/// Save the UI state. まとめて呼ぶ (フロント側でデバウンスする)。
///
/// **並び順もここで保存する。** 専用のコマンドは持たない
/// (docs/specs/git-operations.md の「git を使わない操作」)。
#[tauri::command(rename_all = "snake_case")]
pub async fn save_ui_state(
    state: State<'_, AppState>,
    ui_state: UiState,
) -> Result<(), CommandError> {
    Ok(state
        .write(|registry| registry.set_ui_state(ui_state))
        .await?)
}

/// Forget a repository. ディスクには触らない。
#[tauri::command(rename_all = "snake_case")]
pub async fn remove_repo(state: State<'_, AppState>, repo_id: String) -> Result<(), CommandError> {
    Ok(state.write(|registry| registry.remove(&repo_id)).await?)
}

/// Read one repository's state.
///
/// 失敗はこのリポジトリだけの `Err` にする。1 つの取得失敗で全体を落とさない
/// (docs/specs/data-model.md の `RepoState`)。
#[tauri::command(rename_all = "snake_case")]
pub async fn get_repo_snapshot(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<RepoSnapshot, CommandError> {
    let located = state.locate(&repo_id).await?;
    // 同時実行数を絞る。リポジトリを跨いだ読み取りは並列でよい
    // (docs/adr/0009-concurrency-and-refresh.md)
    let _permit = state.queue().read_permit().await;
    let revision = state.queue().next_revision(&repo_id).await;

    Ok(build_snapshot(
        &repo_id,
        &located.name,
        &located.dir,
        &located.common_dir,
        revision,
    )
    .await?)
}

/// Open the folder picker and register what the user chose.
///
/// **パスがフロントを経由しない。** ダイアログを開くのも Rust 側
/// (docs/security.md)。
#[tauri::command(rename_all = "snake_case")]
pub async fn add_repo<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<AddRepoOutcome, CommandError> {
    let Some(picked) = pick_folder(&app).await else {
        return Ok(AddRepoOutcome::Cancelled);
    };

    // 選んだフォルダがリポジトリのどこであっても、登録するのは最上位。
    // サブディレクトリを登録すると、メインのワークツリーが別ワークツリーとして二重に出る
    let candidate = RepoPath::from_picked_folder(picked);
    let path = match toplevel(&candidate).await {
        Ok(path) => path,
        Err(error) => return Ok(reject(&app, error.to_string())),
    };
    let name = folder_name(&path);

    // 同一性の判定に使う実パスは、最上位から取る
    let repository = RepoPath::from_picked_folder(path.clone());
    let common = match common_dir(&repository).await {
        Ok(common) => common,
        Err(error) => return Ok(reject(&app, error.to_string())),
    };

    // 失敗し得る変更なので、結果をクロージャの戻り値に入れて開く
    let registered = state
        .write(|registry| registry.add(name.clone(), path.clone(), common))
        .await?;

    match registered {
        Ok(id) => Ok(AddRepoOutcome::Added {
            repo: RepoRegistration {
                id,
                name,
                path: path.to_string_lossy().into_owned(),
            },
        }),
        Err(error) => Ok(reject(&app, error.to_string())),
    }
}

/// Tell the user why the folder was not registered, and hand the reason back.
///
/// トーストはフェーズ 3 なので、いまは OS のダイアログで見せる。
/// 黙って何も起きないと、押したのに増えない理由が分からない。
fn reject<R: Runtime>(app: &AppHandle<R>, message: String) -> AddRepoOutcome {
    app.dialog()
        .message(&message)
        .kind(MessageDialogKind::Warning)
        .title("リポジトリを追加できません")
        .show(|_| {});
    AddRepoOutcome::Rejected { message }
}

/// Display name of a folder. 末尾のディレクトリ名を使う。
fn folder_name(path: &std::path::Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Show the OS folder picker.
async fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("リポジトリのフォルダを選ぶ")
        .pick_folder(move |picked| {
            // 受け側が消えていても落とさない
            let _ = sender.send(picked);
        });
    receiver
        .await
        .ok()?
        .and_then(|picked| picked.into_path().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 表示名は末尾のディレクトリ名
    #[test]
    fn takes_the_display_name_from_the_folder() {
        assert_eq!(
            folder_name(&PathBuf::from("/Users/dev/acme-api")),
            "acme-api"
        );
        assert_eq!(
            folder_name(&PathBuf::from("/Users/dev/acme-api/")),
            "acme-api"
        );
        assert_eq!(folder_name(&PathBuf::from("/")), "/");
    }
}
