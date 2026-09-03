use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::children::{Registered, spawn_registered};
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
    /// git ran but its output could not be read from the pipes.
    ///
    /// 起動の失敗と分ける。同じ文言にすると「git が無い」を疑って時間を溶かす。
    Output {
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
            Self::Output { command, source } => {
                write!(f, "git の出力を読めませんでした ({command}): {source}")
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
        // future を落としたときの保険。**これだけでは孫が残る**ので、
        // 締め切りとアプリ終了ではプロセスグループごと畳む
        // (docs/adr/0020-process-group-kill.md)
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
    let spawn = |source| GitError::Spawn {
        command: format_command(args),
        source,
    };
    // **`spawn_registered` を通す。** 直に `spawn()` すると、アプリ終了時の
    // 一括 kill がこの子を拾えない (docs/adr/0020-process-group-kill.md)
    let (child, guard) = spawn_registered(&mut build_command(dir, args)?).map_err(spawn)?;
    let collected = collect(child, guard, limit)
        .await
        .map_err(|source| GitError::Output {
            command: format_command(args),
            source,
        })?;

    Ok(GitOutput {
        command,
        code: collected.code,
        // 不正なバイト列は U+FFFD にする。ファイル名 1 つで
        // スナップショット全体を落とさない
        stdout: String::from_utf8_lossy(&collected.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&collected.stderr).into_owned(),
        timed_out: collected.timed_out,
    })
}

/// Everything one child produced.
#[derive(Debug)]
struct Collected {
    /// `None` は打ち切ったか、シグナルで死んだとき。
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
}

/// Drain both pipes and wait, killing the child's process group after `limit`.
///
/// **両方のパイプを読みながら待つ。** `wait()` だけを締め切りに掛けると、
/// 出力がパイプの容量 (64KB) を超えた時点で子が書き込みでブロックして、
/// 締め切りまで何も進まなくなる。
///
/// **打ち切っても読めた分は残す。** 空にすると、締め切りで落ちた理由が
/// コンソールに何も残らない (docs/specs/ui.md の「コンソール」)。
async fn collect(
    mut child: tokio::process::Child,
    guard: Registered<'_>,
    limit: Option<Duration>,
) -> std::io::Result<Collected> {
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let mut out = Vec::new();
    let mut err = Vec::new();

    let mut failure = None;
    let pump = async {
        let (from_stdout, from_stderr) =
            tokio::join!(drain(&mut stdout, &mut out), drain(&mut stderr, &mut err));
        from_stdout.and(from_stderr)
    };
    let timed_out = match limit {
        Some(limit) => match tokio::time::timeout(limit, pump).await {
            Ok(result) => {
                failure = result.err();
                false
            }
            Err(_) => true,
        },
        None => {
            failure = pump.await.err();
            false
        }
    };

    if timed_out {
        // **孫まで畳む。** 直の子だけ殺すと、接続待ちの `ssh` が残り、
        // 下の `wait` もパイプが閉じるまで返らない
        guard.kill();
    }
    // **待つ側にも上限を掛ける。** パイプを閉じてから居座る子がいると、
    // ここに上限が無いとリポジトリのロックを持ったまま止まる
    let status = wait_within(&mut child, &guard, limit).await?;
    // **控えから外すのは `wait` のあと。** 回収する前に外すと、pid が
    // 別のプロセスに割り当て直されたときに他人の控えを消す
    // (docs/adr/0020-process-group-kill.md)
    drop(guard);
    if let Some(source) = failure {
        return Err(source);
    }

    Ok(Collected {
        code: exit_code(status, timed_out),
        stdout: out,
        stderr: err,
        timed_out,
    })
}

/// Wait for the child, killing its group if it outlives `limit`.
///
/// パイプが閉じたあとも居座る子がいる。`wait` に上限が無いと、
/// 締め切りを指定した呼び出しがそのまま待たされる。
async fn wait_within(
    child: &mut tokio::process::Child,
    guard: &Registered<'_>,
    limit: Option<Duration>,
) -> std::io::Result<std::process::ExitStatus> {
    let Some(limit) = limit else {
        return child.wait().await;
    };
    match tokio::time::timeout(limit, child.wait()).await {
        Ok(status) => status,
        Err(_) => {
            guard.kill();
            child.wait().await
        }
    }
}

/// Exit code to report. **打ち切った実行は終了コードを持たない。**
///
/// 撃ったあとに読める値はこちらが送ったシグナルの結果なので、意味のある成否ではない。
/// 締め切りと同時に子が正常終了した場合も「成功」にはしない。`timed_out` が立って
/// いるのに `is_ok()` が true になると、打ち切りの文言が緑のトーストで出る。
fn exit_code(status: std::process::ExitStatus, timed_out: bool) -> Option<i32> {
    if timed_out { None } else { status.code() }
}

/// Read everything the pipe gives.
///
/// **`read_to_end` は使わない。** tokio が「キャンセル安全ではない。読んだ分が
/// 失われ得る」と宣言している側の API なので、打ち切ったときに出力が残ることを
/// そこに賭けない (いまの実装では残るが、契約は残さなくてよいと言っている)。
/// `read` は「キャンセル安全」と宣言されている。
async fn drain<R>(reader: &mut R, into: &mut Vec<u8>) -> std::io::Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    // **バッファはヒープに置く。** スタックに 8KB の配列を置くと、この future を
    // `try_join!` で 7 本並べたスナップショット取得でスタックが溢れる (実測)
    let mut chunk = vec![0u8; 8 * 1024];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        into.extend_from_slice(&chunk[..read]);
    }
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

    use super::super::children::{ChildGroups, Registered, own_process_group};

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

    /// 固定した環境変数・削る環境変数・固定オプションが、**実際に子プロセスの
    /// 指定に載っている**こと。
    ///
    /// 一覧を作る関数 (`build_env` / `REMOVED_ENV` / `build_args`) の戻り値だけを
    /// 見ていると、`build_command` がそれを使うのをやめても気づけない
    /// (docs/testing.md の「配線を見ていない呼び出し」)
    #[test]
    fn hands_the_fixed_environment_and_options_to_git() {
        use std::ffi::OsStr;

        let directory = tempfile::tempdir().expect("temp dir");
        let path = repo_path_for_test(directory.path());

        let command = build_command(&path, &["status", "--porcelain"]).expect("builds");

        let declared: Vec<_> = command.as_std().get_envs().collect();
        for (name, value) in build_env() {
            assert!(
                declared.contains(&(OsStr::new(name), Some(OsStr::new(value)))),
                "{name} が子プロセスに渡っていない"
            );
        }
        // `env_remove` は値なしで並ぶ
        for name in REMOVED_ENV {
            assert!(
                declared.contains(&(OsStr::new(name), None)),
                "{name} を消していない"
            );
        }
        let args: Vec<_> = command.as_std().get_args().collect();
        assert_eq!(
            args,
            [
                "-c",
                "core.quotepath=false",
                "-c",
                "color.ui=false",
                "status",
                "--porcelain"
            ]
        );
        assert_eq!(command.as_std().get_current_dir(), Some(directory.path()));
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

    /// 打ち切っても、それまでに出た stdout / stderr は残す。
    ///
    /// 空にすると、フェッチが締め切りで落ちたときにコンソールへ何も残らない
    #[tokio::test]
    async fn keeps_the_output_of_a_run_it_had_to_kill() {
        let groups = ChildGroups::new();
        let (child, guard) = spawn_shell(&groups, "echo out; echo err >&2; sleep 30");

        let started = std::time::Instant::now();
        let collected = collect(child, guard, Some(Duration::from_millis(300)))
            .await
            .expect("a killed run is a result, not an error");

        // **締め切りを過ぎたら撃つ。** 撃たないと子が自分で終わるまで待つことになる
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "締め切りを過ぎても待っている ({:?})",
            started.elapsed()
        );
        assert!(collected.timed_out);
        assert_eq!(String::from_utf8_lossy(&collected.stdout), "out\n");
        assert_eq!(String::from_utf8_lossy(&collected.stderr), "err\n");
        // 打ち切った実行は終了コードを持たない
        assert_eq!(collected.code, None);
    }

    /// パイプの容量を超える出力でも詰まらない。
    ///
    /// `wait()` だけを待つ形にすると、書き込み側が 64KB でブロックして
    /// 締め切りまで進まなくなる。**両方のパイプを同時に読む**
    #[tokio::test]
    async fn reads_more_output_than_a_pipe_holds() {
        let groups = ChildGroups::new();
        // stdout と stderr にそれぞれ 200KB 出す
        let (child, guard) = spawn_shell(
            &groups,
            "i=0; while [ $i -lt 200 ]; do printf '%01000d\n' $i; printf '%01000d\n' $i >&2; \
             i=$((i+1)); done",
        );

        let collected = collect(child, guard, Some(Duration::from_secs(10)))
            .await
            .expect("the run finishes");

        assert!(
            !collected.timed_out,
            "パイプが詰まって締め切りに掛かっている"
        );
        assert_eq!(collected.stdout.len(), 200 * 1001);
        assert_eq!(collected.stderr.len(), 200 * 1001);
        assert_eq!(collected.code, Some(0));
    }

    /// パイプを閉じてから居座る子も、締め切りで畳む。
    ///
    /// **`wait` にも上限が要る。** 読み終えたら締め切りが外れる形にすると、
    /// リポジトリのロックを持ったまま止まる
    #[tokio::test]
    async fn kills_a_child_that_outlives_the_deadline_with_its_pipes_closed() {
        let groups = ChildGroups::new();
        // 出力を出してから両方のパイプを閉じ、そのまま居座る
        let (child, guard) = spawn_shell(&groups, "echo out; exec 1>&- 2>&-; sleep 30");

        let started = std::time::Instant::now();
        let collected = collect(child, guard, Some(Duration::from_millis(300)))
            .await
            .expect("a killed run is a result, not an error");

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "パイプが閉じたあと締め切りが効いていない ({:?})",
            started.elapsed()
        );
        assert_eq!(String::from_utf8_lossy(&collected.stdout), "out\n");
    }

    /// 終了コードは打ち切っていないときだけそのまま返す
    #[tokio::test]
    async fn reports_the_exit_code_of_a_run_that_finished() {
        let groups = ChildGroups::new();
        let (child, guard) = spawn_shell(&groups, "exit 3");

        let collected = collect(child, guard, None).await.expect("the run finishes");

        assert_eq!(collected.code, Some(3));
        assert!(!collected.timed_out);
    }

    /// 打ち切った実行は終了コードを持たない。
    ///
    /// 締め切りと同時に子が正常終了しても「成功」にしない
    #[test]
    fn drops_the_exit_code_of_a_killed_run() {
        use std::os::unix::process::ExitStatusExt;

        let success = std::process::ExitStatus::from_raw(0);

        assert_eq!(exit_code(success, false), Some(0));
        assert_eq!(exit_code(success, true), None);
    }

    /// git は自分のプロセスグループで走る。
    ///
    /// グループを作らないと、締め切りとアプリ終了の kill が孫の `ssh` に届かない
    /// (docs/adr/0020-process-group-kill.md)。中から自分のグループ id を出させて、
    /// こちらのグループと違うことを見る
    #[tokio::test]
    async fn runs_git_in_its_own_process_group() {
        let directory = tempfile::tempdir().expect("temp dir");
        // シェルの別名は作業ツリーの最上位で走るので、リポジトリが要る
        std::process::Command::new("git")
            .args(["init", "-q", "."])
            .current_dir(directory.path())
            .status()
            .expect("git init");
        let path = repo_path_for_test(directory.path());

        let output = run(&path, &["-c", "alias.pg=!ps -o pgid= -p $$", "pg"])
            .await
            .expect("git runs");

        assert!(output.is_ok(), "{output:?}");
        let child_group: i32 = output
            .stdout
            .trim()
            .parse()
            .unwrap_or_else(|_| panic!("プロセスグループが読めない: {:?}", output.stdout));
        // SAFETY: getpgrp は引数を取らず、自分のグループ id を返すだけ
        let own_group = unsafe { libc::getpgrp() };
        assert_ne!(
            child_group, own_group,
            "git がアプリと同じプロセスグループで走っている"
        );
    }

    /// テスト用に任意のスクリプトを子プロセスとして起こす。
    /// `collect` は git 以外の子でも同じ形で扱える
    fn spawn_shell<'a>(
        groups: &'a ChildGroups,
        script: &str,
    ) -> (tokio::process::Child, Registered<'a>) {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = own_process_group(&mut command)
            .spawn()
            .expect("sh should start");
        let guard = groups.register(child.id());
        (child, guard)
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
