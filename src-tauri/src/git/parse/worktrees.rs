use super::ParseError;

/// One record of `git worktree list --porcelain -z`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorktreeEntry {
    pub path: String,
    /// Branch checked out here. `None` when the worktree is detached or bare.
    pub branch: Option<String>,
    pub bare: bool,
    pub locked: bool,
    pub prunable: bool,
}

impl WorktreeEntry {
    /// Whether git can be run in this worktree.
    ///
    /// `prunable` と `locked` は除く。消えたワークツリーで `git status` を実行すると
    /// 失敗する (docs/specs/git-operations.md の「読み取り」)。
    pub fn is_usable(&self) -> bool {
        !self.bare && !self.locked && !self.prunable
    }
}

/// Read the output of `git worktree list --porcelain -z`.
///
/// 区画は NUL 区切りで、レコードの終わりは空の区画 (実測)。
///
/// 知らない属性行は読み飛ばす。**ここだけは「想定外の行はエラー」から外している。**
/// レコードの中身は先頭の `worktree <パス>` で決まり、あとから git が属性を足しても
/// 表示に必要な情報は変わらない。エラーにすると git を新しくした日に
/// 全リポジトリのワークツリーが消える。
pub fn parse_worktree_list(stdout: &str) -> Result<Vec<WorktreeEntry>, ParseError> {
    let mut entries = Vec::new();
    let mut current: Option<WorktreeEntry> = None;

    for field in stdout.split('\x00') {
        if field.is_empty() {
            // レコードの終わり
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            continue;
        }

        let (key, value) = match field.split_once(' ') {
            Some((key, value)) => (key, Some(value)),
            None => (field, None),
        };

        if key == "worktree" {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            let path = value.ok_or_else(|| ParseError::new("worktree list", field))?;
            current = Some(WorktreeEntry {
                path: path.to_owned(),
                ..WorktreeEntry::default()
            });
            continue;
        }

        let Some(entry) = current.as_mut() else {
            // `worktree` より前に属性が来るのは想定外
            return Err(ParseError::new("worktree list", field));
        };
        match key {
            "branch" => {
                let reference = value.ok_or_else(|| ParseError::new("worktree list", field))?;
                entry.branch = Some(
                    reference
                        .strip_prefix("refs/heads/")
                        .unwrap_or(reference)
                        .to_owned(),
                );
            }
            "bare" => entry.bare = true,
            "locked" => entry.locked = true,
            "prunable" => entry.prunable = true,
            _ => {}
        }
    }
    if let Some(entry) = current {
        entries.push(entry);
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 実測した出力をそのまま読む。メインが先、リンクされたワークツリーが後
    #[test]
    fn reads_the_real_output() {
        let stdout = "worktree /repos/work\x00HEAD 6ea24a8\x00branch refs/heads/main\x00\x00\
             worktree /repos/wt\x00HEAD 685eabf\x00branch refs/heads/feature/x\x00\x00";

        let entries = parse_worktree_list(stdout).expect("should parse");

        assert_eq!(
            entries,
            vec![
                WorktreeEntry {
                    path: "/repos/work".to_owned(),
                    branch: Some("main".to_owned()),
                    ..WorktreeEntry::default()
                },
                WorktreeEntry {
                    path: "/repos/wt".to_owned(),
                    branch: Some("feature/x".to_owned()),
                    ..WorktreeEntry::default()
                },
            ]
        );
    }

    /// detached なワークツリーはブランチを持たない
    #[test]
    fn reads_a_detached_worktree() {
        let stdout = "worktree /repos/wt\x00HEAD 685eabf\x00detached\x00\x00";

        let entries = parse_worktree_list(stdout).expect("should parse");

        assert_eq!(entries[0].branch, None);
        assert!(entries[0].is_usable());
    }

    /// `prunable` と `locked` は git を実行してはいけない
    /// (docs/specs/git-operations.md)
    #[test]
    fn marks_prunable_and_locked_worktrees() {
        let stdout = "worktree /gone\x00HEAD abc\x00branch refs/heads/x\x00prunable gitdir file points to non-existent location\x00\x00\
             worktree /locked\x00HEAD abc\x00branch refs/heads/y\x00locked\x00\x00";

        let entries = parse_worktree_list(stdout).expect("should parse");

        assert!(entries[0].prunable);
        assert!(!entries[0].is_usable());
        assert!(entries[1].locked);
        assert!(!entries[1].is_usable());
    }

    /// bare リポジトリの本体も除く
    #[test]
    fn marks_a_bare_worktree() {
        let entries =
            parse_worktree_list("worktree /repos/bare.git\x00bare\x00\x00").expect("parse");

        assert!(entries[0].bare);
        assert!(!entries[0].is_usable());
    }

    /// 最後のレコードが空区画で終わっていなくても読む
    #[test]
    fn reads_a_record_without_a_trailing_separator() {
        let entries =
            parse_worktree_list("worktree /repos/work\x00branch refs/heads/main").expect("parse");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].branch, Some("main".to_owned()));
    }

    /// 知らない属性は読み飛ばす。git が属性を足しても表示が消えない
    #[test]
    fn ignores_unknown_attributes() {
        let stdout =
            "worktree /repos/work\x00branch refs/heads/main\x00brand-new-flag value\x00\x00";

        let entries = parse_worktree_list(stdout).expect("should parse");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/repos/work");
    }

    /// `worktree` より前に属性が来る出力はエラーにする
    #[test]
    fn fails_when_an_attribute_comes_first() {
        assert!(parse_worktree_list("branch refs/heads/main\x00\x00").is_err());
    }

    /// パスの無い `worktree` 行もエラーにする
    #[test]
    fn fails_on_a_worktree_without_a_path() {
        assert!(parse_worktree_list("worktree\x00\x00").is_err());
    }

    /// 空の出力は 0 件
    #[test]
    fn reads_empty_output() {
        assert_eq!(parse_worktree_list(""), Ok(Vec::new()));
    }
}
