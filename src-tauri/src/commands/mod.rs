//! Tauri commands. The IPC boundary.
//!
//! **汎用の「任意の git を実行する」コマンドは作らない。**
//! 引数はリポジトリの id にして、パスを引数に取るコマンドを作らない
//! (docs/security.md)。
//!
//! 引数の名前は `rename_all = "snake_case"` で DTO と揃える。Tauri の既定は
//! camelCase なので、そのままだと `{ repoId }` と `{ origin_url }` が混ざる。

mod error;
// `generate_handler!` はコマンドごとに生成されるマクロも要るので、
// 再エクスポートではなく本当のパスで参照させる
pub mod repo;

pub use error::CommandError;
