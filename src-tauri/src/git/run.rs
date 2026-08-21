use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::parse::ParseError;
use super::validate::{ObjectNameError, RefNameError};
use crate::store::RepoPath;

/// PATH built by hand.
///
/// `.app` を Finder から起動すると launchd の最小 PATH になり、ターミナルから
/// `pnpm tauri dev` したときと環境が違う (docs/specs/git-operations.md の「共通」)。
const SEARCH_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// Options put in front of every subcommand.
///
/// `core.quotepath=false` は日本語のパスがエスケープされるのを防ぐ。
/// 色は `color.ui=false` で止める。`--no-color` はサブコマンドごとのオプションなので
/// 共通では使えない。
const CONFIG_ARGS: [&str; 4] = ["-c", "core.quotepath=false", "-c", "color.ui=false"];

/// Result of one git run. **非ゼロ終了は失敗ではなく結果**
/// (docs/adr/0009-concurrency-and-refresh.md)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    /// The command as the user would type it, for the console.
    pub command: String,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Whether the run was killed for taking too long.
    ///
    /// 打ち切りは終了コードでは見分けられない (シグナルで死んでも `None`)。
    /// 文言を出し分けるので独立して持つ。
    pub timed_out: bool,
}

impl GitOutput {
    pub fn is_ok(&self) -> bool {
        self.code == Some(0)
    }
}

/// Something went wrong on the app side, not in git's own result.
#[derive(Debug)]
pub enum GitError {
    /// The registered directory is gone.
    MissingDirectory { path: PathBuf },
    /// The directory exists but is not a git repository.
    NotARepository { path: PathBuf },
    /// A git repository without a working tree (bare, or the `.git` directory itself).
    NoWorktree { path: PathBuf },
    /// git could not be started at all.
    Spawn {
        command: String,
        source: std::io::Error,
    },
    /// git exited non-zero where the caller needed it to succeed.
    Failed {
        command: String,
        code: Option<i32>,
        stderr: String,
    },
    /// git ran but its output could not be read.
    Parse(ParseError),
    /// A reference argument did not pass validation.
    RefName(RefNameError),
    /// A sha argument did not pass validation.
    ObjectName(ObjectNameError),
}

impl From<ParseError> for GitError {
    fn from(source: ParseError) -> Self {
        Self::Parse(source)
    }
}

impl From<RefNameError> for GitError {
    fn from(source: RefNameError) -> Self {
        Self::RefName(source)
    }
}

impl From<ObjectNameError> for GitError {
    fn from(source: ObjectNameError) -> Self {
        Self::ObjectName(source)
    }
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // 文言は docs/specs/ui.md の「読み込み中とエラー」に合わせる
            Self::MissingDirectory { .. } => write!(f, "ディレクトリが見つかりません"),
            Self::NotARepository { .. } => write!(f, "git リポジトリではありません"),
            Self::NoWorktree { .. } => write!(
                f,
                "作業コピーがありません (bare リポジトリと .git は登録できません)"
            ),
            Self::Spawn { command, source } => {
                write!(f, "git を実行できませんでした ({command}): {source}")
            }
            Self::Failed {
                command,
                code,
                stderr,
            } => {
                let reason = stderr.lines().next().unwrap_or("").trim();
                let code = code.map_or_else(|| "signal".to_owned(), |code| code.to_string());
                write!(f, "{command} が失敗しました (exit {code}): {reason}")
            }
            Self::Parse(source) => write!(f, "{source}"),
            Self::RefName(source) => write!(f, "{source}"),
            Self::ObjectName(source) => write!(f, "{source}"),
        }
    }
}

impl std::error::Error for GitError {}

/// The command line as the user would type it. コンソールに出す形
/// (docs/specs/ui.md の「コンソール」)。
fn format_command(args: &[&str]) -> String {
    let mut command = String::from("git");
    for arg in args {
        command.push(' ');
        command.push_str(arg);
    }
    command
}

/// Environment variables every run gets.
///
/// 一覧にしているのはテストで縛るため。理由は
/// docs/specs/git-operations.md の「共通」にある。
fn build_env() -> [(&'static str, &'static str); 5] {
    [
        // PATH を明示する。Finder から起動すると launchd の最小 PATH になる
        ("PATH", SEARCH_PATH),
        // 出力を英語に固定する。パースが git の設定と環境で変わらないようにする
        ("LC_ALL", "C"),
        // 認証待ちで固まらせない
        ("GIT_TERMINAL_PROMPT", "0"),
        // 読み取りでロックを取らない
        ("GIT_OPTIONAL_LOCKS", "0"),
        // これが無いと接続不能時に 1 本あたり 75 秒ブロックする
        // (docs/adr/0009-concurrency-and-refresh.md)
        (
            "GIT_SSH_COMMAND",
            "ssh -o ConnectTimeout=5 -o BatchMode=yes",
        ),
    ]
}

/// Environment variables that must not reach git.
///
/// 呼び出し元のシェルに残っていると、別のリポジトリを触ってしまう。
const REMOVED_ENV: [&str; 2] = ["GIT_DIR", "GIT_WORK_TREE"];

/// Everything actually handed to git, including the fixed options.
fn build_args<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut all = Vec::with_capacity(CONFIG_ARGS.len() + args.len());
    all.extend_from_slice(&CONFIG_ARGS);
    all.extend_from_slice(args);
    all
}

/// Build the child process. 引数は配列で渡す。シェルを経由しない。
/// 環境変数は固定する (docs/security.md の「外部コマンドの実行」)。
fn build_command(dir: &RepoPath, args: &[&str]) -> Result<Command, GitError> {
    let path = dir.as_path();
    if !path.is_dir() {
        return Err(GitError::MissingDirectory {
            path: path.to_owned(),
        });
    }

    let mut command_line = Command::new("git");
    command_line
        .args(build_args(args))
        .current_dir(path)
        // 標準入力を閉じる。認証やエディタの待ちで固まらせない
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 打ち切ったときに子プロセスを残さない。`wait_with_output` の future を
        // 落とすと `Child` も落ちるので、そこで kill が走る
        .kill_on_drop(true);
    for (name, value) in build_env() {
        command_line.env(name, value);
    }
    for name in REMOVED_ENV {
        command_line.env_remove(name);
    }
    Ok(command_line)
}

/// Run git in `dir`. 締め切りは持たない (ローカルの操作用)。
pub async fn run(dir: &RepoPath, args: &[&str]) -> Result<GitOutput, GitError> {
    run_inner(dir, args, None).await
}

/// Run git in `dir`, killing it after `limit`.
///
/// ネットワーク操作に使う。VPN 切断や機内では 1 本あたり 75 秒前後ブロックして、
/// その間キューが詰まる (docs/adr/0009-concurrency-and-refresh.md)。
pub async fn run_within(
    dir: &RepoPath,
    args: &[&str],
    limit: Duration,
) -> Result<GitOutput, GitError> {
    run_inner(dir, args, Some(limit)).await
}

async fn run_inner(
    dir: &RepoPath,
    args: &[&str],
    limit: Option<Duration>,
) -> Result<GitOutput, GitError> {
    let command = format_command(args);
    let child = build_command(dir, args)?
        .spawn()
        .map_err(|source| GitError::Spawn {
            command: command.clone(),
            source,
        })?;

    let waited = match limit {
        Some(limit) => match tokio::time::timeout(limit, child.wait_with_output()).await {
            Ok(waited) => waited,
            Err(_) => {
                return Ok(GitOutput {
                    command,
                    code: None,
                    stdout: String::new(),
                    stderr: String::new(),
                    timed_out: true,
                });
            }
        },
        None => child.wait_with_output().await,
    };

    let output = waited.map_err(|source| GitError::Spawn {
        command: command.clone(),
        source,
    })?;

    Ok(GitOutput {
        command,
        code: output.status.code(),
        // 不正なバイト列は U+FFFD にする。ファイル名 1 つで
        // スナップショット全体を落とさない
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        timed_out: false,
    })
}

/// Run git and require a zero exit code.
pub async fn run_ok(dir: &RepoPath, args: &[&str]) -> Result<String, GitError> {
    let output = run(dir, args).await?;
    if !output.is_ok() {
        return Err(GitError::Failed {
            command: output.command,
            code: output.code,
            stderr: output.stderr,
        });
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// コンソールに出す形は、ユーザーが打つ形と同じにする。
    /// `-c core.quotepath=false` のような内部の指定は混ぜない
    #[test]
    fn formats_the_command_as_the_user_would_type_it() {
        assert_eq!(
            format_command(&["status", "--porcelain", "-z"]),
            "git status --porcelain -z"
        );
    }

    /// 環境変数の固定。どれも実測した事故を根拠に入れているので、
    /// 名前と値をそのまま縛る (docs/specs/git-operations.md の「共通」)
    #[test]
    fn fixes_the_environment() {
        assert_eq!(
            build_env(),
            [
                (
                    "PATH",
                    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
                ),
                ("LC_ALL", "C"),
                ("GIT_TERMINAL_PROMPT", "0"),
                ("GIT_OPTIONAL_LOCKS", "0"),
                (
                    "GIT_SSH_COMMAND",
                    "ssh -o ConnectTimeout=5 -o BatchMode=yes"
                ),
            ]
        );
    }

    /// 呼び出し元のシェルから持ち込ませない環境変数
    #[test]
    fn removes_the_repository_pointing_environment() {
        assert_eq!(REMOVED_ENV, ["GIT_DIR", "GIT_WORK_TREE"]);
    }

    /// 固定のオプションはサブコマンドより前に置く。後ろに置くと効かない
    #[test]
    fn puts_the_fixed_options_before_the_subcommand() {
        assert_eq!(
            build_args(&["status"]),
            vec![
                "-c",
                "core.quotepath=false",
                "-c",
                "color.ui=false",
                "status"
            ]
        );
    }

    /// ディレクトリが消えていることを、git を起動する前に見分ける。
    /// 見出しに出す文言が「git を実行できませんでした」になると原因が分からない
    /// (docs/specs/ui.md)
    #[tokio::test]
    async fn reports_a_missing_directory() {
        let directory = tempfile::tempdir().expect("temp dir");
        let gone = directory.path().join("gone");
        let path = repo_path_for_test(&gone);

        let error = run(&path, &["status"]).await.expect_err("should fail");

        assert!(
            matches!(error, GitError::MissingDirectory { .. }),
            "{error}"
        );
        assert_eq!(error.to_string(), "ディレクトリが見つかりません");
    }

    /// 締め切りを過ぎたら打ち切る。終了コードでは見分けられないので
    /// `timed_out` で返す (docs/adr/0009-concurrency-and-refresh.md)
    #[tokio::test]
    async fn reports_a_run_that_was_killed_for_taking_too_long() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = repo_path_for_test(directory.path());

        let output = run_within(&path, &["status"], Duration::ZERO)
            .await
            .expect("a killed run is a result, not an error");

        assert!(output.timed_out);
        assert!(!output.is_ok());
        assert_eq!(output.code, None);
        assert_eq!(output.command, "git status");
    }

    /// 締め切りを持たない実行は打ち切られない
    #[tokio::test]
    async fn does_not_mark_an_ordinary_run_as_timed_out() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = repo_path_for_test(directory.path());

        let output = run(&path, &["--version"]).await.expect("git runs");

        assert!(!output.timed_out);
        assert!(output.is_ok());
    }

    /// テスト用に `RepoPath` を作る。登録済みのリポジトリを 1 件だけ持つ
    /// レジストリを通す
    fn repo_path_for_test(path: &std::path::Path) -> RepoPath {
        let mut registry = crate::store::Registry::default();
        let id = registry
            .add("test".to_owned(), path.to_owned(), path.join(".git"))
            .expect("first repository registers");
        registry.resolve(&id).expect("registered id resolves")
    }
}
