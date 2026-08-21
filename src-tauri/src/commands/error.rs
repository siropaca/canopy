use std::fmt;

use serde::{Serialize, Serializer};

use crate::git::GitError;
use crate::state::StateError;
use crate::store::UnknownRepo;

/// Why a command could not be carried out.
///
/// `Err` はアプリ側の異常だけに使う。git の非ゼロ終了は結果として返す
/// (docs/adr/0009-concurrency-and-refresh.md)。
/// フロントには文字列 1 本として届く。そのまま人に見せられる文言にする。
#[derive(Debug, PartialEq, Eq)]
pub struct CommandError(String);

impl CommandError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<GitError> for CommandError {
    fn from(source: GitError) -> Self {
        Self(source.to_string())
    }
}

impl From<StateError> for CommandError {
    fn from(source: StateError) -> Self {
        Self(source.to_string())
    }
}

impl From<UnknownRepo> for CommandError {
    fn from(source: UnknownRepo) -> Self {
        Self(source.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// フロントには文字列で届く。オブジェクトにすると `[object Object]` になる
    #[test]
    fn serializes_as_a_plain_string() {
        let error = CommandError::new("ディレクトリが見つかりません");

        assert_eq!(
            serde_json::to_value(&error).expect("should serialize"),
            serde_json::json!("ディレクトリが見つかりません")
        );
    }

    /// git のエラーは人に見せる文言のまま渡す
    #[test]
    fn keeps_the_git_message() {
        let error: CommandError = GitError::MissingDirectory {
            path: std::path::PathBuf::from("/gone"),
        }
        .into();

        assert_eq!(error.message(), "ディレクトリが見つかりません");
    }
}
