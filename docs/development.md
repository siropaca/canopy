# 開発

## 環境

ランタイムは mise で揃える。

```sh
mise install                  # Node・pnpm・Rust
pnpm install
```

バージョンは `mise.toml` で固定する。  
Rust は mise が内部で rustup を使って入れるので、`rustup default` で別のツールチェインに切り替えない。  
pnpm は Node の bin にも入っていて PATH で勝つことがあるため、`mise.toml` と `package.json` の `packageManager` に同じバージョンを書く。

## コマンド

| コマンド | 用途 |
| --- | --- |
| `pnpm tauri dev` | アプリを起動して開発する |
| `pnpm tauri build` | ビルドする。**macOS 向けのみ** ([adr/0014-macos-only.md](adr/0014-macos-only.md)) |
| `pnpm check` | 下をまとめて実行する。**コミット前とフェーズ完了時のゲート** |
| `pnpm gen:types` | Rust の struct から TypeScript の型を生成する |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier で整形する。**Markdown と `docs/` は対象外** |
| `pnpm test` | Vitest |
| `pnpm test:watch` | Vitest の watch。TDD 中はこれを回す |
| `cargo test` | Rust のテスト (`src-tauri/` で実行) |
| `cargo clippy -- -D warnings` | Rust の lint。警告はエラー扱い |
| `cargo fmt --check` | Rust の整形チェック |

`pnpm check` の中身は次のとおり。  
**型の検査を typecheck より前に置く。**

| 順 | スクリプト | 中身 |
| --- | --- | --- |
| 1 | `check:generated` | 生成した型が最新か (`scripts/check-generated.sh`) |
| 2 | `typecheck` | `tsc --noEmit` |
| 3 | `lint` | ESLint |
| 4 | `check:format` | Prettier の `--check` |
| 5 | `test` | Vitest |
| 6 | `build` | `vite build`。**本番ビルドが通るか** |
| 7 | `check:rust` | `cargo fmt --check` → `cargo check --locked` → `cargo clippy --locked --all-targets -- -D warnings` → `cargo test --locked` |
| 8 | `check:docs` | `python3 scripts/check-docs.py` |

`build` を入れているのは、CSS の壊れや `index.html` の参照ミスを他の 7 段が誰も読まないため。  
存在しないファイルの `@import` を足しても、typecheck も lint も Vitest も緑になる。

`--locked` を付けているのは、`Cargo.lock` のコミット漏れを黙って解決させないため。

`cargo check` を clippy より前に置いているのは、**dev-dependencies を含めない**ビルドを  
1 回通すため。`cargo test` と `clippy --all-targets` は dev-dependencies も解決するので、  
feature が合成されて本体のビルドだけが落ちる状態を見逃す ([pitfalls.md](pitfalls.md))。

型の検査が後ろにあると、tsc が古い生成物を見て通ってしまう。  
検査は緑なのにフロントが壊れている状態が作れるので、必ずこの順にする。

`check:generated` は一時ディレクトリに生成して `src/ipc/generated/` と比べる。  
検査がファイルを書き換えないので、「手で直した生成物」と「struct を変えたのに生成し忘れ」の両方をそのまま検出できる。  
落ちたら `pnpm gen:types` を実行して差分をコミットする。

「通ったか」を 1 コマンドで判定できる状態を保つ。  
新しい検査を足したら `pnpm check` にも足す。

## 命名

| 対象 | 規則 | 例 |
| --- | --- | --- |
| React コンポーネント | PascalCase、1 ファイル 1 コンポーネント | `BranchRow.tsx` |
| フック | `use` 始まり | `useRepoSnapshot.ts` |
| 純粋関数のモジュール | camelCase | `buildTree.ts` |
| CSS Modules | コンポーネントと同名 | `BranchRow.module.css` |
| Rust のモジュール | snake_case | `git/parse_status.rs` |
| Tauri コマンド | snake_case の動詞句 | `checkout_branch` |
| DTO | フロントと Rust で同じ名前 | `RepoSnapshot` |

識別子とコメントは英語。  
ドキュメントとコミットメッセージは日本語。

## ブランチとコミット

- ブランチ名は英小文字・数字・ハイフン。日本語を使わない。例 `feat/repo-tree`
- コミットは Conventional Commits に従う。`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:` + 日本語本文
- 破壊的変更は `feat!:` のように `!` を付ける
- バージョンは Semantic Versioning。個人ツールなので v1.0.0 は「常用に耐える」タイミングで付ける
- ステージはパスを明示する。`git add -A` と `git add .` は使わない
- コミット前に `git diff --cached --name-only` で意図したファイルだけかを確認する

## CI

GitHub Actions で `pnpm check` を実行するだけにする。  
ランナーは macOS だけ。他のプラットフォームは対象外。  
ローカルとまったく同じコマンドを回すのが要点。  
CI 専用の**検査**を増やすと、ローカルで通ったのに CI で落ちる状態を作ってしまう。

用意 (provisioning) だけは CI 側に書く。  
`rustup component add rustfmt clippy` を 1 段置いている。  
mise が入れた Rust には rustfmt と clippy が付いてこないので、  
`cargo fmt --check` が「コンポーネントが無い」で落ちる ([pitfalls.md](pitfalls.md))。

## 依存の追加

1. 追加前に確認を取る
2. 標準ライブラリと既存の依存で済まないかを先に検討する
3. 追加したら ADR かフェーズのプランに「何のために入れたか」を残す
4. ロックファイル (`pnpm-lock.yaml` / `Cargo.lock`) は必ずコミットする
5. 定期的に `pnpm audit` と `cargo deny check` で棚卸しする
6. `@types/*` は実行するランタイムとメジャーを揃える。`@types/node` が `mise.toml` の Node より新しいと、存在しない API が typecheck を通る

すでに決まっている依存は [adr/](adr/) を参照。

## 型の共有

生成の手順。

```sh
pnpm gen:types    # src/ipc/generated/ に出力される
```

出力先は `.cargo/config.toml` の `TS_RS_EXPORT_DIR` で固定している。  
`cargo test` を直接叩いても同じ場所に出る。

この設定はリポジトリのルートに置く。  
cargo は `--manifest-path` の位置ではなく**実行したディレクトリ**から設定を探すため、`src-tauri/.cargo/` に置くとルートから叩いたときに効かない。  
リポジトリの外から `--manifest-path` で叩くと設定が見つからず、`src-tauri/bindings/` に出る。

`[env]` に `force` を付けない。  
`scripts/check-generated.sh` と `check:rust` が環境変数で出力先を差し替えているので、設定側を勝たせると検査が自分自身と比べることになる。

同じファイルで `TS_RS_LARGE_INT = "number"` も指定している。  
ts-rs は既定で `i64` / `u64` を `bigint` にするが、**IPC は JSON なので実行時は number で届く。**  
`bigint` と宣言すると型だけが嘘になり、`new Date(committed_at)` が実行時に落ちる。  
この指定が消えると `check:generated` が差分を見つけて落ちる。

`cargo test` は `export_bindings_*` という普通のテストとして生成を実行する。  
そのため `check:rust` は `TS_RS_EXPORT_DIR` を `target/` の下に向けて回す。  
検査がコミット対象のファイルを書き換えないようにするため。

生成物はコミットする。  
`pnpm check` の `check:generated` が最新かを確認するので、忘れると検査で落ちる。

方針と理由は [adr/0013-type-generation.md](adr/0013-type-generation.md)。
