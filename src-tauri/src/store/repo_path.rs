use std::path::{Path, PathBuf};

/// A directory git is allowed to run in.
///
/// **これを作れるのは `store` の中だけ。** 登録済みのリポジトリか、そのリポジトリの
/// `worktree list --porcelain` が返したパスからしか作れない形にしてある。
/// フロントから来た文字列で git を実行させないため (docs/security.md)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoPath(PathBuf);

impl RepoPath {
    /// Only the registry hands out the first `RepoPath`.
    pub(super) fn registered(path: PathBuf) -> Self {
        Self(path)
    }

    /// A folder the user just chose in the OS folder picker.
    ///
    /// 登録前なのでレジストリからは引けない。**呼んで良いのは
    /// `add_repo` がダイアログから受け取った値だけ。** フロントから来た文字列を
    /// ここに通さない (docs/security.md)。
    pub fn from_picked_folder(path: PathBuf) -> Self {
        Self(path)
    }

    /// A path that came out of this repository's `worktree list --porcelain`.
    ///
    /// ワークツリーは登録パスの外にあることが多いので、登録パス配下かどうかでは
    /// 判定できない。git の出力から来たことを型で表す。
    pub fn worktree_of(&self, path: &str) -> Self {
        Self(PathBuf::from(path))
    }

    pub fn as_path(&self) -> &Path {
        &self.0
    }

    /// Display form. 表示とコピーのためにフロントへ返してよい (docs/security.md)。
    pub fn to_display_string(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }

    /// テスト専用の入口。**製品コードからは作れない** (`cfg(test)`)。
    #[cfg(test)]
    pub fn for_tests(path: &str) -> Self {
        Self(PathBuf::from(path))
    }
}
