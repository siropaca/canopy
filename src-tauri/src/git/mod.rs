//! Running git and reading its output.
//!
//! git はライブラリではなく CLI を叩く (docs/adr/0002-git-cli.md)。
//! 実行の決まりは docs/security.md、どのコマンドを使うかは
//! docs/specs/git-operations.md にある。
//!
//! **書き込みの引数は `validate::Arg` を通す。** 低レベルの `run` / `run_within` は
//! この中だけで使う。外へ出すのは読み取りの `run_ok` だけ
//! (docs/adr/0017-typed-git-arguments.md)。

mod message;
pub mod parse;
mod run;
mod secret;
mod snapshot;
mod validate;
mod write;

pub use message::describe;
pub use run::{GitError, run_ok};
pub use secret::mask_credentials;
pub use snapshot::{build_snapshot, common_dir, toplevel};
pub use validate::RefNameError;
pub use write::{Operation, push_preview, run_operation};
