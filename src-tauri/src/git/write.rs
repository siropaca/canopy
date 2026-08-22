use super::message::describe;
use super::parse::{parse_remotes, parse_worktree_list};
use super::run::{GitError, GitOutput, run, run_ok, run_within};
use super::secret::mask_credentials;
use super::validate::{Arg, Composed, ObjectName, RefName};
use crate::model::{CommandResult, CommandStep, Commit, PushPreview};
use crate::op_kind::OpKind;
use crate::store::RepoPath;

/*
 * 書き込み操作の git 実行。
 *
 * どのコマンドを実行するかは docs/specs/git-operations.md の「書き込み」の表。
 * **参照は必ず `RefName` を通す。** 生の `&str` を git に渡す道をここに作らない
 * (docs/security.md)。
 *
 * 並行制御と状態の取り直しはここには無い。順序は `crate::ops` が持つ。
 */

/// Format for reading a local branch's upstream.
///
/// `lstrip=3` は `refs/remotes/origin/feature/x` から `feature/x` を取る。
/// `lstrip=2` は表示用の `origin/feature/x`。
const UPSTREAM_FORMAT: &str =
    "%(refname:lstrip=2)%00%(upstream:remotename)%00%(upstream:lstrip=3)%00%(upstream:lstrip=2)";

/// Remote used when a branch has no upstream configured.
const DEFAULT_REMOTE: &str = "origin";

fn default_remote() -> Composed {
    Composed::from_git_output(DEFAULT_REMOTE)
}

/// How many commits the push dialog lists at most.
const PREVIEW_LIMIT: &str = "--max-count=50";

/// One write operation, named by intent.
///
/// **汎用の「任意の git を実行する」入口は作らない** (docs/security.md)。
/// 参照名は生の文字列で受けて、実行の前に必ず検証する。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operation {
    /// `git fetch --prune`
    Fetch,
    /// `git pull --rebase` (現在のブランチ)
    PullCurrent,
    /// 他のローカルブランチを早送りする。**チェックアウトしない**
    FastForward { branch: String },
    /// ローカル / リモート追跡ブランチへ切り替える
    Checkout { name: String },
    /// タグを detached でチェックアウトする
    CheckoutTag { tag: String },
    /// 切り替えてからプルする。前が失敗したら止める
    CheckoutAndPull { name: String },
    /// `git checkout -`
    Previous,
    /// `git push`。`force_with_lease` に sha があれば強制プッシュ
    Push {
        branch: String,
        force_with_lease: Option<String>,
    },
    /// `git branch -m` のあと `git branch --unset-upstream`
    Rename { from: String, to: String },
}

impl Operation {
    /// Which operation this is, for the queue's de-duplication.
    ///
    /// 2 段の操作は最初の段の種別にする。フェッチ連打を止めるのが目的なので、
    /// 「同じボタンを 2 回押した」が同じキーになれば足りる。
    pub fn kind(&self) -> OpKind {
        match self {
            Self::Fetch => OpKind::Fetch,
            Self::PullCurrent => OpKind::Pull,
            Self::FastForward { .. } => OpKind::FastForward,
            Self::Checkout { .. } | Self::CheckoutAndPull { .. } => OpKind::Checkout,
            Self::CheckoutTag { .. } => OpKind::CheckoutTag,
            Self::Previous => OpKind::Previous,
            Self::Push {
                force_with_lease, ..
            } => {
                if force_with_lease.is_some() {
                    OpKind::ForcePush
                } else {
                    OpKind::Push
                }
            }
            Self::Rename { .. } => OpKind::Rename,
        }
    }
}

/// Carry out one operation. 呼ぶのは `crate::ops` だけ。
pub async fn run_operation(dir: &RepoPath, op: &Operation) -> Result<CommandResult, GitError> {
    match op {
        Operation::Fetch => Ok(fetch(dir).await?),
        Operation::PullCurrent => Ok(pull(dir).await?),
        Operation::FastForward { branch } => fast_forward(dir, branch).await,
        Operation::Checkout { name } => checkout(dir, name).await,
        Operation::CheckoutTag { tag } => checkout_tag(dir, tag).await,
        Operation::CheckoutAndPull { name } => checkout_and_pull(dir, name).await,
        Operation::Previous => Ok(one(
            dir,
            OpKind::Previous,
            &[Arg::Fixed("checkout"), Arg::Fixed("-")],
        )
        .await?),
        Operation::Push {
            branch,
            force_with_lease,
        } => push(dir, branch, force_with_lease.as_deref()).await,
        Operation::Rename { from, to } => rename(dir, from, to).await,
    }
}

/// Fast-forward a branch that is **not** checked out here.
///
/// `git fetch <リモート> <上流>:<名前>` は早送りできるときだけ成功する。
/// そのブランチが別のワークツリーにあるときは、**そのワークツリーで**
/// `git pull --rebase` に切り替える
/// (docs/specs/git-operations.md の「他のローカルブランチのプルは早送り限定」)。
async fn fast_forward(dir: &RepoPath, branch: &str) -> Result<CommandResult, GitError> {
    let name = RefName::branch(dir, branch).await?;

    if let Some(path) = worktree_holding(dir, name.as_str()).await? {
        let worktree = dir.worktree_of(&path);
        return pull(&worktree).await;
    }

    let upstream = upstream_of(dir, name.as_str()).await?;
    let remote = upstream
        .as_ref()
        .map_or_else(default_remote, |upstream| upstream.remote.clone());
    // 追跡先が無ければローカルと同じ名前を取りに行く
    let source = upstream.as_ref().map_or_else(
        || Composed::from_git_output(name.as_str()),
        |up| up.branch.clone(),
    );
    let refspec = Composed::refspec(&source, &name);
    one(
        dir,
        OpKind::FastForward,
        &[
            Arg::Fixed("fetch"),
            Arg::Fixed("--end-of-options"),
            Arg::Value(&remote),
            Arg::Value(&refspec),
        ],
    )
    .await
}

/// Switch to a branch. リモート追跡の名前も受ける。
///
/// **ローカルの有無は Rust 側で判定する。** フロントが分岐を持たない
/// (docs/specs/git-operations.md の「書き込み」)。
async fn checkout(dir: &RepoPath, requested: &str) -> Result<CommandResult, GitError> {
    let name = RefName::branch(dir, requested).await?;
    let locals = local_branches(dir).await?;

    // 完全一致するローカルが先。`origin/x` という名前のローカルブランチも作れる
    if locals.iter().any(|local| local.name == name.as_str()) {
        return switch_to(dir, &name).await;
    }

    let Some(short) = strip_remote(dir, name.as_str()).await? else {
        // ローカルにもリモートにも無い。git の文言で失敗を見せる
        return switch_to(dir, &name).await;
    };
    let local = RefName::branch(dir, &short).await?;

    if locals.iter().any(|entry| entry.name == local.as_str()) {
        // **既存のローカルに切り替わるだけ。リモートの先端には乗らない。**
        // そのことを UI に明示する (docs/specs/git-operations.md)
        let mut result = switch_to(dir, &local).await?;
        if result.ok {
            result.message = Some(format!(
                "既存のローカルブランチ {} に切り替えました (リモートの先端には乗りません)",
                local.as_str()
            ));
        }
        return Ok(result);
    }

    one(
        dir,
        OpKind::Checkout,
        &[
            Arg::Fixed("switch"),
            Arg::Fixed("-c"),
            Arg::Ref(&local),
            Arg::Fixed("--track"),
            Arg::Ref(&name),
        ],
    )
    .await
}

/// `git switch --end-of-options <名前>`
async fn switch_to(dir: &RepoPath, name: &RefName) -> Result<CommandResult, GitError> {
    one(
        dir,
        OpKind::Checkout,
        &[
            Arg::Fixed("switch"),
            Arg::Fixed("--end-of-options"),
            Arg::Ref(name),
        ],
    )
    .await
}

/// `git fetch --prune`
async fn fetch(dir: &RepoPath) -> Result<CommandResult, GitError> {
    one(
        dir,
        OpKind::Fetch,
        &[Arg::Fixed("fetch"), Arg::Fixed("--prune")],
    )
    .await
}

/// `git pull --rebase`。**`pull.rebase` の設定を見ずに常に rebase する**
async fn pull(dir: &RepoPath) -> Result<CommandResult, GitError> {
    one(
        dir,
        OpKind::Pull,
        &[Arg::Fixed("pull"), Arg::Fixed("--rebase")],
    )
    .await
}

/// Check a tag out as a detached HEAD.
///
/// `git checkout <タグ名>` は同名のブランチがあるとブランチに切り替わるので、
/// 完全修飾名で渡す (docs/pitfalls.md)。
async fn checkout_tag(dir: &RepoPath, tag: &str) -> Result<CommandResult, GitError> {
    let name = RefName::tag(dir, tag).await?;
    let reference = Composed::tag_ref(&name);
    one(
        dir,
        OpKind::CheckoutTag,
        &[
            Arg::Fixed("checkout"),
            Arg::Fixed("--detach"),
            Arg::Fixed("--end-of-options"),
            Arg::Value(&reference),
        ],
    )
    .await
}

/// Switch, then pull. **前が失敗したら止める。**
///
/// 両方の出力を残す。前半が成功して後半が失敗したときに取り直さないと、
/// 画面は元のブランチのまま・実態は rebase 中になる
/// (docs/specs/git-operations.md の「実行後」)。
async fn checkout_and_pull(dir: &RepoPath, requested: &str) -> Result<CommandResult, GitError> {
    let switched = checkout(dir, requested).await?;
    if !switched.ok {
        return Ok(switched);
    }

    let pulled = pull(dir).await?;
    let mut steps = switched.steps;
    steps.extend(pulled.steps);
    // プルの結果を優先する。成功したときはチェックアウトの注記を残す
    Ok(CommandResult::ran(
        steps,
        pulled.ok,
        pulled.message.or(switched.message),
    ))
}

/// Push a branch. `lease` があれば強制プッシュ。
async fn push(
    dir: &RepoPath,
    branch: &str,
    lease: Option<&str>,
) -> Result<CommandResult, GitError> {
    let name = RefName::branch(dir, branch).await?;
    let upstream = upstream_of(dir, name.as_str()).await?;
    let remote = upstream
        .as_ref()
        .map_or_else(default_remote, |upstream| upstream.remote.clone());

    let Some(lease) = lease else {
        let Some(upstream) = upstream else {
            // 追跡ブランチが無いときは `-u` で同名を作る
            // (docs/specs/git-operations.md)
            return one(
                dir,
                OpKind::Push,
                &[
                    Arg::Fixed("push"),
                    Arg::Fixed("-u"),
                    Arg::Fixed("--end-of-options"),
                    Arg::Value(&remote),
                    Arg::Ref(&name),
                ],
            )
            .await;
        };
        // **push 先を明示する。** 省くと git は同名の ref を更新するので、
        // 上流の名前が違うブランチ (`dev` が `origin/main` を追跡) で
        // 意図しない ref を作る
        let refspec = Composed::push_refspec(&name, &upstream.branch);
        return one(
            dir,
            OpKind::Push,
            &[
                Arg::Fixed("push"),
                Arg::Fixed("--end-of-options"),
                Arg::Value(&remote),
                Arg::Value(&refspec),
            ],
        )
        .await;
    };

    // **sha を明示する。** 値なしの `--force-with-lease` は手元の追跡 ref を
    // 基準にするので、フェッチした直後は無意味になる
    // (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)
    let sha = ObjectName::parse(lease)?;
    let remote_branch = upstream.as_ref().map_or_else(
        || Composed::from_git_output(name.as_str()),
        |up| up.branch.clone(),
    );
    // **リースの参照名と push 先を必ず一致させる。** ずれるとリースが効かない
    let option = Composed::lease(&remote_branch, &sha);
    let refspec = Composed::push_refspec(&name, &remote_branch);
    one(
        dir,
        OpKind::ForcePush,
        &[
            Arg::Fixed("push"),
            Arg::Value(&option),
            Arg::Fixed("--end-of-options"),
            Arg::Value(&remote),
            Arg::Value(&refspec),
        ],
    )
    .await
}

/// Rename a branch and drop the upstream it kept.
///
/// `git branch -m` は `branch.<新>.merge` を旧名のまま残す。外さないと、
/// プッシュで origin 側に旧名と新名が両方できる (docs/pitfalls.md)。
async fn rename(dir: &RepoPath, from: &str, to: &str) -> Result<CommandResult, GitError> {
    let old = RefName::branch(dir, from).await?;
    let new = RefName::branch(dir, to).await?;

    let renamed = one(
        dir,
        OpKind::Rename,
        &[
            Arg::Fixed("branch"),
            Arg::Fixed("-m"),
            Arg::Fixed("--end-of-options"),
            Arg::Ref(&old),
            Arg::Ref(&new),
        ],
    )
    .await?;
    if !renamed.ok {
        return Ok(renamed);
    }
    // 追跡先が無いブランチに `--unset-upstream` を撃つと失敗するので、
    // 残っているときだけ実行する
    if upstream_of(dir, new.as_str()).await?.is_none() {
        return Ok(renamed);
    }

    let unset = one(
        dir,
        OpKind::Rename,
        &[
            Arg::Fixed("branch"),
            Arg::Fixed("--unset-upstream"),
            Arg::Fixed("--end-of-options"),
            Arg::Ref(&new),
        ],
    )
    .await?;
    let mut steps = renamed.steps;
    steps.extend(unset.steps);
    Ok(CommandResult::ran(steps, unset.ok, unset.message))
}

/// Everything the push dialog needs. 読み取りだけ。
pub async fn push_preview(dir: &RepoPath, branch: &str) -> Result<PushPreview, GitError> {
    let name = RefName::branch(dir, branch).await?;
    let upstream = upstream_of(dir, name.as_str()).await?;
    let remote = upstream
        .as_ref()
        .map_or_else(default_remote, |upstream| upstream.remote.clone());

    let Some(upstream) = upstream else {
        return Ok(PushPreview {
            branch: name.as_str().to_owned(),
            remote: remote.as_str().to_owned(),
            // 追跡先が無いときはリモート側も同じ名前で作る
            remote_branch: name.as_str().to_owned(),
            upstream: None,
            remote_sha: None,
            ahead: Vec::new(),
            behind: Vec::new(),
        });
    };

    // **追跡先が `gone` でも失敗させない。** 設定は残るので `%(upstream:...)` は
    // 名前を返すが、ref が無いので `git log <上流>..<名前>` は exit 128 になる。
    // sha が引けないときは比べる相手が無いので、件数を空で返す
    let sha = remote_sha(dir, &upstream.full).await?;
    let (ahead, behind) = match sha {
        Some(_) => {
            let here = Composed::of_ref(&name);
            (
                log_range(dir, &upstream.full, &here).await?,
                log_range(dir, &here, &upstream.full).await?,
            )
        }
        None => (Vec::new(), Vec::new()),
    };

    Ok(PushPreview {
        branch: name.as_str().to_owned(),
        remote: remote.as_str().to_owned(),
        remote_branch: upstream.branch.as_str().to_owned(),
        remote_sha: sha,
        ahead,
        behind,
        upstream: Some(upstream.full.as_str().to_owned()),
    })
}

/// Sha of `reference`, or `None` when it does not exist.
async fn remote_sha(dir: &RepoPath, reference: &Composed) -> Result<Option<String>, GitError> {
    let output = run(
        dir,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            reference.as_str(),
        ],
    )
    .await?;
    if !output.is_ok() {
        return Ok(None);
    }
    let sha = output.stdout.trim();
    Ok(if sha.is_empty() {
        None
    } else {
        Some(sha.to_owned())
    })
}

/// Commits in `to` that are not in `from`.
async fn log_range(
    dir: &RepoPath,
    from: &Composed,
    to: &Composed,
) -> Result<Vec<Commit>, GitError> {
    let range = Composed::range(from, to);
    let stdout = run_ok(
        dir,
        &[
            "log",
            "--format=%h%x00%s",
            PREVIEW_LIMIT,
            "--end-of-options",
            range.as_str(),
        ],
    )
    .await?;

    let mut commits = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let (hash, subject) = line.split_once('\x00').unwrap_or((line, ""));
        commits.push(Commit {
            hash: hash.to_owned(),
            subject: subject.to_owned(),
        });
    }
    Ok(commits)
}

/// A local branch and its upstream.
#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalBranch {
    name: String,
    upstream: Option<Upstream>,
}

/// A branch's upstream, as git printed it.
///
/// **git 自身の出力から来た値**なので `Composed` で持つ。ユーザーの入力は
/// ここに入らない (docs/adr/0017-typed-git-arguments.md)。
#[derive(Debug, Clone, PartialEq, Eq)]
struct Upstream {
    /// `origin`
    remote: Composed,
    /// Branch name on the remote, e.g. `feature/x`.
    branch: Composed,
    /// Display form, e.g. `origin/feature/x`.
    full: Composed,
}

async fn local_branches(dir: &RepoPath) -> Result<Vec<LocalBranch>, GitError> {
    let format = format!("--format={UPSTREAM_FORMAT}");
    let stdout = run_ok(dir, &["for-each-ref", "refs/heads", format.as_str()]).await?;
    Ok(parse_local_upstreams(&stdout))
}

async fn upstream_of(dir: &RepoPath, branch: &str) -> Result<Option<Upstream>, GitError> {
    Ok(local_branches(dir)
        .await?
        .into_iter()
        .find(|local| local.name == branch)
        .and_then(|local| local.upstream))
}

/// Read the output of `for-each-ref refs/heads` with [`UPSTREAM_FORMAT`].
fn parse_local_upstreams(stdout: &str) -> Vec<LocalBranch> {
    let mut branches = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\x00').collect();
        let [name, remote, branch, full] = fields.as_slice() else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        branches.push(LocalBranch {
            name: (*name).to_owned(),
            upstream: if remote.is_empty() || branch.is_empty() {
                None
            } else {
                Some(Upstream {
                    remote: Composed::from_git_output(*remote),
                    branch: Composed::from_git_output(*branch),
                    full: Composed::from_git_output(*full),
                })
            },
        });
    }
    branches
}

/// The other worktree that has `branch` checked out, if any.
async fn worktree_holding(dir: &RepoPath, branch: &str) -> Result<Option<String>, GitError> {
    let stdout = run_ok(dir, &["worktree", "list", "--porcelain", "-z"]).await?;
    let registered = resolved(dir.as_path());
    for entry in parse_worktree_list(&stdout)? {
        if !entry.is_usable() || entry.branch.as_deref() != Some(branch) {
            continue;
        }
        if resolved(std::path::Path::new(&entry.path)) == registered {
            continue;
        }
        return Ok(Some(entry.path));
    }
    Ok(None)
}

fn resolved(path: &std::path::Path) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned())
}

/// Split `origin/feature/x` into the branch part, using the real remote list.
///
/// **`origin` だけとは限らない。** fork を持つリポジトリでは `upstream/main` が
/// 並ぶ (docs/specs/git-operations.md の「読み取り」)。
async fn strip_remote(dir: &RepoPath, name: &str) -> Result<Option<String>, GitError> {
    let stdout = run_ok(dir, &["remote"]).await?;
    for remote in parse_remotes(&stdout) {
        if let Some(short) = name.strip_prefix(&format!("{remote}/"))
            && !short.is_empty()
        {
            return Ok(Some(short.to_owned()));
        }
    }
    Ok(None)
}

/// Run one command and turn it into a result.
///
/// **引数は `Arg` でしか渡せない。** 生の `&str` を受ける形にしておくと、
/// 新しい操作を足すときに未検証の名前が git へ届く
/// (docs/adr/0017-typed-git-arguments.md)。
async fn one(dir: &RepoPath, kind: OpKind, args: &[Arg<'_>]) -> Result<CommandResult, GitError> {
    let raw: Vec<&str> = args.iter().map(Arg::as_str).collect();
    // **書き込みは必ず締め切りを持つ。** 「付けるか付けないか」の分岐にすると、
    // 分岐を消しても振る舞いで見分けられない。値は `OpKind` が決める
    let output = run_within(dir, &raw, kind.deadline()).await?;
    Ok(into_result(kind, dir, output))
}

/// Turn one git run into a result, masking credentials on the way out.
fn into_result(kind: OpKind, dir: &RepoPath, output: GitOutput) -> CommandResult {
    let ok = output.is_ok();
    let message = if ok {
        None
    } else {
        Some(describe(kind, &output))
    };
    CommandResult::ran(
        vec![CommandStep {
            // **実際に走らせた場所を載せる。** ワークツリーで走ることがある
            dir: dir.to_display_string(),
            command: mask_credentials(&output.command),
            code: output.code,
            stdout: mask_credentials(&output.stdout),
            stderr: mask_credentials(&output.stderr),
        }],
        ok,
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 重複排除のキーは操作の種別。強制プッシュは通常のプッシュと別扱い
    #[test]
    fn names_the_kind_of_every_operation() {
        assert_eq!(Operation::Fetch.kind(), OpKind::Fetch);
        assert_eq!(Operation::PullCurrent.kind(), OpKind::Pull);
        assert_eq!(
            Operation::FastForward {
                branch: "main".to_owned()
            }
            .kind(),
            OpKind::FastForward
        );
        assert_eq!(
            Operation::CheckoutAndPull {
                name: "main".to_owned()
            }
            .kind(),
            OpKind::Checkout
        );
        assert_eq!(
            Operation::Push {
                branch: "main".to_owned(),
                force_with_lease: None
            }
            .kind(),
            OpKind::Push
        );
        assert_eq!(
            Operation::Push {
                branch: "main".to_owned(),
                force_with_lease: Some("9f3c1ab".to_owned())
            }
            .kind(),
            OpKind::ForcePush
        );
    }

    /// 追跡先を読む。`origin` 以外のリモートも正しく分ける
    #[test]
    fn reads_the_upstream_of_every_local_branch() {
        let stdout = "main\x00origin\x00main\x00origin/main\n\
             feature/x\x00upstream\x00feature/x\x00upstream/feature/x\n\
             solo\x00\x00\x00\n";

        let branches = parse_local_upstreams(stdout);

        assert_eq!(
            branches,
            vec![
                LocalBranch {
                    name: "main".to_owned(),
                    upstream: Some(Upstream {
                        remote: Composed::from_git_output("origin"),
                        branch: Composed::from_git_output("main"),
                        full: Composed::from_git_output("origin/main"),
                    }),
                },
                LocalBranch {
                    name: "feature/x".to_owned(),
                    upstream: Some(Upstream {
                        remote: Composed::from_git_output("upstream"),
                        branch: Composed::from_git_output("feature/x"),
                        full: Composed::from_git_output("upstream/feature/x"),
                    }),
                },
                LocalBranch {
                    name: "solo".to_owned(),
                    upstream: None,
                },
            ]
        );
    }

    /// コンソールの行に出す作業ディレクトリは、**実際に git を走らせた場所**。
    ///
    /// 別のワークツリーにあるブランチのプルは、そのワークツリーで実行する
    /// (docs/specs/git-operations.md)。登録したパスを出すと、行を読んでも
    /// どこで走ったか分からない。
    #[test]
    fn carries_the_directory_git_ran_in() {
        let worktree = RepoPath::for_tests("/Users/dev/worktrees/feature-x");

        let result = into_result(
            OpKind::Pull,
            &worktree,
            GitOutput {
                command: "git pull --rebase".to_owned(),
                code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
            },
        );

        assert_eq!(result.steps[0].dir, "/Users/dev/worktrees/feature-x");
    }

    /// 出力の認証情報は結果に載せる前に消す (docs/security.md)
    #[test]
    fn masks_credentials_in_every_field() {
        let result = into_result(
            OpKind::Push,
            &RepoPath::for_tests("/repos/acme-api"),
            GitOutput {
                command: "git push https://u:p@github.com/acme/api.git main".to_owned(),
                code: Some(1),
                stdout: "To https://x-access-token:secret@github.com/acme/api.git\n".to_owned(),
                stderr: "error: failed to push to https://u:p@github.com/acme/api.git\n".to_owned(),
                timed_out: false,
            },
        );

        let step = &result.steps[0];
        assert!(!step.stdout.contains("secret"), "{}", step.stdout);
        assert!(!step.stderr.contains("p@github"), "{}", step.stderr);
        assert_eq!(step.stdout, "To https://***@github.com/acme/api.git\n");
        // **コマンド行もマスクする。** URL を引数に取る形があり得る
        assert_eq!(
            step.command,
            "git push https://***@github.com/acme/api.git main"
        );
        assert!(!result.ok);
        assert_eq!(result.message.as_deref(), Some("プッシュに失敗しました"));
    }
}
