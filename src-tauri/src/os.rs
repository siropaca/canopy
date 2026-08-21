//! Handing a repository path to a macOS application.
//!
//! **`shell` プラグインの汎用実行は有効にしない。** `open` を叩く操作も
//! 意図ごとのコマンドとして持つ (docs/adr/0015-auxiliary-operations.md)。
//! 引数は配列で渡す。シェルを経由しない (docs/security.md)。

use std::fmt;
use std::process::Stdio;

use tokio::process::Command;

use crate::store::RepoPath;

/// Why the application could not be opened.
#[derive(Debug)]
pub enum OsError {
    /// `open` そのものが起動できなかった
    Spawn(std::io::Error),
    /// `open` が非ゼロで終わった
    Failed { code: Option<i32>, stderr: String },
}

impl fmt::Display for OsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(source) => write!(f, "open を実行できませんでした: {source}"),
            Self::Failed { code, stderr } => {
                let reason = stderr.lines().next().unwrap_or("").trim();
                let code = code.map_or_else(|| "signal".to_owned(), |code| code.to_string());
                write!(f, "open が失敗しました (exit {code}): {reason}")
            }
        }
    }
}

impl std::error::Error for OsError {}

/// Show the repository in Finder.
pub async fn reveal_in_finder(dir: &RepoPath) -> Result<(), OsError> {
    open(&["-R".to_owned(), display(dir)]).await
}

/// Open the repository in the configured terminal application.
pub async fn open_in_terminal(dir: &RepoPath, app: &str) -> Result<(), OsError> {
    open(&["-a".to_owned(), app.to_owned(), display(dir)]).await
}

/// The path as a string. 登録済みのリポジトリか、その `worktree list` が返した
/// パスしか `RepoPath` にならないので、ここには外から来た文字列が入らない。
fn display(dir: &RepoPath) -> String {
    dir.as_path().to_string_lossy().into_owned()
}

async fn open(args: &[String]) -> Result<(), OsError> {
    let output = Command::new("open")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(OsError::Spawn)?;

    if output.status.success() {
        return Ok(());
    }
    Err(OsError::Failed {
        code: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 失敗は文言にして返す。握りつぶさない
    #[tokio::test]
    async fn reports_why_open_failed() {
        let error = open(&["--このオプションは無い".to_owned()])
            .await
            .expect_err("open should fail");

        assert!(
            error.to_string().starts_with("open が失敗しました"),
            "{error}"
        );
    }
}
