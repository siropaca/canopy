# フェーズ 0: 土台

## 目的

空のウィンドウが起動し、`pnpm check` が通る状態を作る。  
これ以降のフェーズが「検査が通ったか」だけで進捗を判定できるようにする。

## 前提

- [adr/0001-tauri-react.md](../adr/0001-tauri-react.md) — Tauri + React
- [adr/0003-state-and-styling.md](../adr/0003-state-and-styling.md) — Zustand + CSS Modules
- [adr/0013-type-generation.md](../adr/0013-type-generation.md) — 型は Rust から生成する
- [adr/0014-macos-only.md](../adr/0014-macos-only.md) — macOS のみ
- [../development.md](../development.md) — コマンドと命名
- [../architecture.md](../architecture.md) — ディレクトリ

**Rust がこの環境に入っていない。** 最初に mise で入れる。

## やること

- [ ] `mise.toml` を作る。Node LTS と Rust を固定する
- [ ] Tauri 2 + React + TypeScript + Vite のプロジェクトを生成する
- [ ] `docs/architecture.md` のディレクトリ構成に合わせてディレクトリを作る (空でよい)
- [ ] tsconfig を strict にする。`any` を禁止する lint ルールを入れる
- [ ] ESLint + Prettier を入れる。**Markdown は Prettier の対象から外す** (行末 2 スペースのハードブレークが壊れる)
- [ ] Vitest を入れる。1 つだけ意味のあるテストを書いて通す
- [ ] `pnpm check` を作る。**順序は [../development.md](../development.md) のとおり。型生成を先頭に置く**
- [ ] `pnpm check` に `python3 scripts/check-docs.py` を入れる。ドキュメントの整合性もコミット前に落ちるようにする
- [ ] `docs/mock/tree.tmpl.html` の `:root` から `src/shared/styles/tokens.css` にトークンを移植する
- [ ] トークンがモックと一致していることを確認するテストを書く ([../testing.md](../testing.md) の最後の節)
- [ ] GitHub Actions で `pnpm check` を実行するワークフローを作る
- [ ] Tauri の capability を最小にする。使わない plugin の権限を消す ([../security.md](../security.md))
- [ ] `app.security.csp` と `devCsp` を書き下す。dev は Vite の HMR があるので `connect-src` を開ける
- [ ] **インライン `style` 属性を使わない前提で作る。** モックはインデントを `style="--d:N"` で渡しているが、CSP と衝突する。`data-depth` + CSS 側のセレクタか ref 経由の `setProperty` にする ([../security.md](../security.md))
- [ ] 型生成 (`pnpm gen:types`) を作る。生成物の差分チェック (`git diff --exit-code`) も `pnpm check` に入れる ([../adr/0013-type-generation.md](../adr/0013-type-generation.md))
- [ ] ビルド対象を macOS のみにする ([../adr/0014-macos-only.md](../adr/0014-macos-only.md))
- [ ] `pnpm tauri dev` で空のウィンドウが出ることを確認する
- [ ] `.claude/settings.json` に整形の hook を足すか検討する。入れるなら実際に発火することを確認してから

## テスト

| 層 | 内容 |
| --- | --- |
| フロント ユニット | トークンがモックと一致していること |
| Rust ユニット | 何か 1 つ。`cargo test` が動くことの確認 |

この段階でテストの置き場所と書き方を決める。  
以降のフェーズはこの形に倣う。

## 完了条件

[../workflow.md](../workflow.md) の共通条件に加えて。

- [ ] `pnpm check` が通る
- [ ] `pnpm tauri dev` でウィンドウが出る
- [ ] CI が緑

## やらないこと

- git を叩く処理。フェーズ 1 で入れる
- UI の作り込み。トークンの移植だけで、コンポーネントは作らない
