//! Parsers for git's machine-readable output.
//!
//! 出力形式は引数で固定する (docs/specs/git-operations.md の「共通」)。
//! **想定外の行は捨てずにエラーにする** (docs/testing.md)。

mod branches;
mod refs;
mod remotes;
mod status;
mod worktrees;

use std::fmt;

pub use branches::{LOCAL_BRANCH_FORMAT, parse_local_branches};
pub use refs::{REF_FORMAT, parse_refs, parse_remote_refs, split_remote_ref};
pub use remotes::{normalize_origin_url, parse_remotes};
pub use status::parse_status;
pub use worktrees::{WorktreeEntry, parse_worktree_list};

/// git の出力が読めなかったとき。
///
/// 黙って無視すると「ブランチが 1 本足りない」という形で表に出て、原因が追えない。
#[derive(Debug, PartialEq, Eq)]
pub struct ParseError {
    /// What was being read, e.g. `refs/heads`.
    pub context: &'static str,
    /// The line (or record) that could not be read.
    pub found: String,
}

impl ParseError {
    fn new(context: &'static str, found: impl Into<String>) -> Self {
        Self {
            context,
            found: found.into(),
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "git の出力を読めませんでした ({}): {:?}",
            self.context, self.found
        )
    }
}

impl std::error::Error for ParseError {}
