//! Tauri commands. The IPC boundary.
//!
//! **汎用の「任意の git を実行する」コマンドは作らない。**
//! 引数はリポジトリの id にして、パスを引数に取るコマンドを作らない
//! (docs/security.md)。
//!
//! 引数の名前は `rename_all = "snake_case"` で DTO と揃える。Tauri の既定は
//! camelCase なので、そのままだと `{ repoId }` と `{ origin_url }` が混ざる。
//!
//! コマンドは 3 つのファイルに分ける。`generate_handler!` に並ぶ順序も同じ。
//!
//! | ファイル | 何を置くか |
//! | --- | --- |
//! | `settings.rs` | 設定の読み書き、リポジトリの追加と削除 |
//! | `snapshot.rs` | 読み取り |
//! | `ops.rs` | 書き込みと補助操作 |
//!
//! **コマンドの中身は薄くする。** 並行制御と取り直しの順序は `crate::ops` が持つ。

mod error;
// `generate_handler!` はコマンドごとに生成されるマクロも要るので、
// 再エクスポートではなく本当のパスで参照させる
pub mod ops;
pub mod settings;
pub mod snapshot;

pub use error::CommandError;
