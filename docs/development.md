# 開発

## 環境

ランタイムは mise で揃える。

```sh
mise install                  # Node LTS と Rust
pnpm install
```

Rust は `mise.toml` で管理する。  
rustup と混在させない。

## コマンド

| コマンド | 用途 |
| --- | --- |
| `pnpm tauri dev` | アプリを起動して開発する |
| `pnpm tauri build` | ビルドする。**macOS 向けのみ** ([adr/0014-macos-only.md](adr/0014-macos-only.md)) |
| `pnpm check` | 下をまとめて実行する。**コミット前とフェーズ完了時のゲート** |
| `pnpm gen:types` | Rust の struct から TypeScript の型を生成する |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm test:watch` | Vitest の watch。TDD 中はこれを回す |
| `cargo test` | Rust のテスト (`src-tauri/` で実行) |
| `cargo clippy -- -D warnings` | Rust の lint。警告はエラー扱い |
| `cargo fmt --check` | Rust の整形チェック |

`pnpm check` の順序は次のとおり。**型生成を typecheck より前に置く。**

```
gen:types && git diff --exit-code src/ipc/generated \
  && typecheck && lint && test \
  && cargo fmt --check && cargo clippy -- -D warnings && cargo test \
  && python3 scripts/check-docs.py
```

型生成が後ろにあると、tsc が古い生成物を見て通ってしまう。  
検査は緑なのにフロントが壊れている状態が作れるので、必ずこの順にする。  
`git diff --exit-code` で「生成物が最新か」も同時に確認する。  
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
CI 専用の手順を増やすと、ローカルで通ったのに CI で落ちる状態を作ってしまう。

## 依存の追加

1. 追加前に確認を取る
2. 標準ライブラリと既存の依存で済まないかを先に検討する
3. 追加したら ADR かフェーズのプランに「何のために入れたか」を残す
4. ロックファイル (`pnpm-lock.yaml` / `Cargo.lock`) は必ずコミットする
5. 定期的に `pnpm audit` と `cargo deny check` で棚卸しする

すでに決まっている依存は [adr/](adr/) を参照。

## 型の共有

生成の手順。

```sh
pnpm gen:types    # src/ipc/generated/ に出力される
```

生成物はコミットする。  
`pnpm check` が先頭で生成して差分を確認するので、忘れると検査で落ちる。

方針と理由は [adr/0013-type-generation.md](adr/0013-type-generation.md)。
