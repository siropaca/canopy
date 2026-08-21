//! Running git and reading its output.
//!
//! git はライブラリではなく CLI を叩く (docs/adr/0002-git-cli.md)。
//! 実行の決まりは docs/security.md、どのコマンドを使うかは
//! docs/specs/git-operations.md にある。

pub mod parse;
mod run;
mod snapshot;

pub use run::{GitError, GitOutput, run, run_ok};
pub use snapshot::{build_snapshot, common_dir, toplevel};
