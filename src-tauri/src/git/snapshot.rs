use std::path::{Path, PathBuf};

use super::parse::{
    self, LOCAL_BRANCH_FORMAT, REF_FORMAT, WorktreeEntry, parse_local_branches, parse_refs,
    parse_remote_refs, parse_remotes, parse_status, parse_worktree_list,
};
use super::run::{GitError, run, run_ok};
use crate::model::{ChangeList, Head, RepoSnapshot, Worktree};
use crate::store::RepoPath;

/// Read `git rev-parse --show-toplevel`.
///
/// **登録できるフォルダかの判定を兼ねる。**
/// - bare リポジトリと `.git` そのものを選んだ場合は失敗する
///   (`--git-common-dir` は成功してしまうので、これで弾く)
/// - リポジトリのサブディレクトリを選んだ場合は、最上位のパスが返る
///   そのまま登録すると、メインのワークツリーが「別のワークツリー」として二重に出る
pub async fn toplevel(dir: &RepoPath) -> Result<PathBuf, GitError> {
    let output = run(dir, &["rev-parse", "--show-toplevel"]).await?;
    if !output.is_ok() {
        return Err(if output.stderr.contains("not a git repository") {
            GitError::NotARepository {
                path: dir.as_path().to_owned(),
            }
        } else {
            // bare リポジトリはここに来る (`must be run in a work tree`)
            GitError::NoWorktree {
                path: dir.as_path().to_owned(),
            }
        });
    }
    let raw = output.stdout.trim();
    if raw.is_empty() {
        return Err(GitError::NoWorktree {
            path: dir.as_path().to_owned(),
        });
    }
    Ok(PathBuf::from(raw))
}

/// Read `git rev-parse --git-common-dir` as an absolute, resolved path.
///
/// リポジトリの同一性の判定に使う。リンクされたワークツリーからは
/// メインの `.git` の絶対パスが返る (実測)。
pub async fn common_dir(dir: &RepoPath) -> Result<PathBuf, GitError> {
    let output = run(dir, &["rev-parse", "--git-common-dir"]).await?;
    if !output.is_ok() {
        return Err(if output.stderr.contains("not a git repository") {
            GitError::NotARepository {
                path: dir.as_path().to_owned(),
            }
        } else {
            GitError::Failed {
                command: output.command,
                code: output.code,
                stderr: output.stderr,
            }
        });
    }

    let raw = output.stdout.trim();
    let relative = Path::new(raw);
    let absolute = if relative.is_absolute() {
        relative.to_owned()
    } else {
        dir.as_path().join(relative)
    };
    // macOS の /var -> /private/var のような symlink を畳む。
    // 畳まないとメインとワークツリーが別物に見えて重複判定が抜ける
    Ok(std::fs::canonicalize(&absolute).unwrap_or(absolute))
}

/// Read everything the tree needs for one repository.
pub async fn build_snapshot(
    id: &str,
    name: &str,
    dir: &RepoPath,
    common_dir: &Path,
    revision: u64,
) -> Result<RepoSnapshot, GitError> {
    let local_format = format!("--format={LOCAL_BRANCH_FORMAT}");
    let ref_format = format!("--format={REF_FORMAT}");
    let local_args = ["for-each-ref", "refs/heads", local_format.as_str()];
    let remote_args = ["for-each-ref", "refs/remotes", ref_format.as_str()];
    let tag_args = ["for-each-ref", "refs/tags", ref_format.as_str()];
    // 1 リポジトリ分の読み取りは同時に投げる。リポジトリ間の同時実行数は
    // 呼び出し側の semaphore で絞る (docs/adr/0009-concurrency-and-refresh.md)
    let (head, local_out, remote_out, tag_out, status_out, worktree_out, remote_names) = tokio::try_join!(
        read_head(dir),
        run_ok(dir, &local_args),
        run_ok(dir, &remote_args),
        run_ok(dir, &tag_args),
        run_ok(dir, &["status", "--porcelain", "-z"]),
        run_ok(dir, &["worktree", "list", "--porcelain", "-z"]),
        run_ok(dir, &["remote"]),
    )?;

    let remotes = parse_remotes(&remote_names);
    let mut local = parse_local_branches(&local_out)?;
    let remote = parse_remote_refs(&remote_out, &remotes)?;
    let tags = parse_refs(&tag_out, "refs/tags")?;
    let changes = parse_status(&status_out, ChangeList::MAX_ITEMS)?;

    let worktrees = read_worktrees(dir, &worktree_out).await?;
    for worktree in &worktrees {
        if let Some(branch) = local
            .iter_mut()
            .find(|branch| branch.name == worktree.branch)
        {
            branch.worktree_path = Some(worktree.path.clone());
        }
    }

    Ok(RepoSnapshot {
        id: id.to_owned(),
        name: name.to_owned(),
        path: dir.to_display_string(),
        origin_url: read_origin_url(dir).await?,
        local,
        remote,
        tags,
        worktrees,
        changes,
        fetched_at: read_fetched_at(common_dir),
        revision,
        head,
    })
}

/// Read HEAD. detached なら参照名 (タグ名か短縮ハッシュ) を持たせる
/// (docs/specs/data-model.md)。
async fn read_head(dir: &RepoPath) -> Result<Head, GitError> {
    let current = run_ok(dir, &["branch", "--show-current"]).await?;
    let current = current.trim();
    if !current.is_empty() {
        return Ok(Head::branch(current));
    }

    // detached。タグを指しているならタグ名を出す
    let described = run(dir, &["describe", "--tags", "--exact-match", "HEAD"]).await?;
    let tag = described.stdout.trim();
    if described.is_ok() && !tag.is_empty() {
        return Ok(Head::detached(tag));
    }

    let hash = run_ok(dir, &["rev-parse", "--short", "HEAD"]).await?;
    Ok(Head::detached(hash.trim()))
}

/// `origin` の URL。origin が無いリポジトリもあるので、失敗は None にする。
async fn read_origin_url(dir: &RepoPath) -> Result<Option<String>, GitError> {
    let output = run(dir, &["remote", "get-url", "origin"]).await?;
    if !output.is_ok() {
        return Ok(None);
    }
    Ok(parse::normalize_origin_url(&output.stdout))
}

/// Worktrees other than the registered one, with their own uncommitted changes.
async fn read_worktrees(dir: &RepoPath, stdout: &str) -> Result<Vec<Worktree>, GitError> {
    let registered = resolved(dir.as_path());
    let mut worktrees = Vec::new();

    for entry in parse_worktree_list(stdout)? {
        let Some(branch) = usable_branch(&entry) else {
            continue;
        };
        if resolved(Path::new(&entry.path)) == registered {
            continue;
        }
        // git の出力から来たパスなので実行して良い (docs/security.md)
        let worktree_dir = dir.worktree_of(&entry.path);
        let status = run_ok(&worktree_dir, &["status", "--porcelain", "-z"]).await?;
        worktrees.push(Worktree {
            branch: branch.to_owned(),
            path: entry.path.clone(),
            changes: parse_status(&status, ChangeList::MAX_ITEMS)?,
        });
    }
    Ok(worktrees)
}

/// The branch of a worktree we can attach to a row.
///
/// detached なワークツリーはどのブランチにも紐づかないので出さない
/// (docs/specs/data-model.md)。
fn usable_branch(entry: &WorktreeEntry) -> Option<&str> {
    if !entry.is_usable() {
        return None;
    }
    entry.branch.as_deref()
}

/// Compare paths after resolving symlinks. 解決できないパスはそのまま比べる。
fn resolved(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned())
}

/// Unix milliseconds of the last successful fetch, read from `FETCH_HEAD`.
///
/// git が fetch のたびに書き直すファイル。クローン直後は無いので None。
fn read_fetched_at(common_dir: &Path) -> Option<i64> {
    let modified = std::fs::metadata(common_dir.join("FETCH_HEAD"))
        .ok()?
        .modified()
        .ok()?;
    let since_epoch = modified
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .ok()?;
    i64::try_from(since_epoch.as_millis()).ok()
}
