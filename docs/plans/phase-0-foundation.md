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

- [x] `mise.toml` を作る。Node LTS と Rust を固定する
- [x] Tauri 2 + React + TypeScript + Vite のプロジェクトを生成する
- [x] `docs/architecture.md` のディレクトリ構成に合わせてディレクトリを作る (空でよい)
- [x] tsconfig を strict にする。`any` を禁止する lint ルールを入れる
- [x] ESLint + Prettier を入れる。**Markdown は Prettier の対象から外す** (行末 2 スペースのハードブレークが壊れる)
- [x] Vitest を入れる。1 つだけ意味のあるテストを書いて通す
- [x] `pnpm check` を作る。**順序は [../development.md](../development.md) のとおり。型の検査を先頭に置く**
- [x] `pnpm check` に `python3 scripts/check-docs.py` を入れる。ドキュメントの整合性もコミット前に落ちるようにする
- [x] `docs/mock/tree.tmpl.html` の `:root` から `src/shared/styles/tokens.css` にトークンを移植する
- [x] トークンがモックと一致していることを確認するテストを書く ([../testing.md](../testing.md) の最後の節)
- [x] GitHub Actions で `pnpm check` を実行するワークフローを作る
- [x] Tauri の capability を最小にする。使わない plugin の権限を消す ([../security.md](../security.md))
- [x] `app.security.csp` と `devCsp` を書き下す。dev は Vite の HMR があるので `connect-src` を開ける
- [x] **インライン `style` 属性を使わない前提で作る。** モックはインデントを `style="--d:N"` で渡しているが、CSP と衝突する。`data-depth` + CSS 側のセレクタか ref 経由の `setProperty` にする ([../security.md](../security.md))
- [x] 型生成 (`pnpm gen:types`) を作る。生成物が最新かの検査も `pnpm check` に入れる ([adr/0013-type-generation.md](../adr/0013-type-generation.md))
- [x] ビルド対象を macOS のみにする ([adr/0014-macos-only.md](../adr/0014-macos-only.md))
- [x] `pnpm tauri dev` で空のウィンドウが出ることを確認する
- [x] `.claude/settings.json` に整形の hook を足すか検討する。入れるなら実際に発火することを確認してから → **入れない** (下の「決めたこと」)

## テスト

| 層 | 内容 |
| --- | --- |
| フロント ユニット | トークンがモックと一致していること (`src/shared/styles/tokens.test.ts`) |
| Rust ユニット | DTO のフィールド名が snake_case のまま JSON に出ること (`src-tauri/src/model/change.rs`) |

テストの置き場所は [../testing.md](../testing.md) の表のとおりにした。  
以降のフェーズはこの形に倣う。

どちらのテストも、わざと値を壊して落ちることを確認してから採用した。  
トークンは `--row` を 22px にすると落ちる。

## 決めたこと

固定したバージョン。

| 対象 | 版 | 理由 |
| --- | --- | --- |
| Node | 24.18.0 | LTS |
| pnpm | 11.9.0 | `mise.toml` と `package.json` の `packageManager` に同じ値を書く |
| Rust | 1.98.0 | 安定版の最新 |
| TypeScript | 6.0.3 (キャレット無し) | 7 系は typescript-eslint が未対応で、型を見る lint が全部使えなくなる |
| `@types/node` | `^24` | `mise.toml` の Node とメジャーを揃える。新しいと存在しない API が typecheck を通る |
| 最小 macOS | 14.0 | `lib: ES2023` を許すなら Safari 16.4 以降が要る。ビルド対象も `safari17` に揃える |

入れた依存。

| パッケージ | 何のために |
| --- | --- |
| `react` / `react-dom` / `@tauri-apps/api` | 本体 |
| `vite` / `@vitejs/plugin-react` / `@tauri-apps/cli` | ビルドと起動 |
| `typescript` / `typescript-eslint` / `eslint` / `@eslint/js` / `globals` | 型と lint |
| `eslint-plugin-react-hooks` / `eslint-plugin-react-refresh` | React 固有の lint |
| `prettier` | 整形 |
| `vitest` | フロントのテスト |
| `@types/node` | テストで `node:fs` を使う |
| `serde` / `serde_json` / `tauri` | Rust 側の本体 |
| `ts-rs` 12 | TypeScript の型を生成する |

Zustand・仮想スクロール・自前スクロールバー・React Testing Library はまだ入れていない。  
最初に使うフェーズで入れる。

決めたこと。

- **生成物の検査は git ではなく一時ディレクトリとの比較にした。** `git diff` は未追跡の新しい型を見逃すし、検査のためにコミットを要求することになる。`scripts/check-generated.sh` が生成し直して `diff -ru` で比べる
- **ts-rs の出力先はルートの `.cargo/config.toml` で固定した。** cargo は `--manifest-path` ではなく実行したディレクトリから設定を探すので、`src-tauri/.cargo/` に置くとルートから叩いたときに効かない
- **capability は `core:window` / `core:webview` / `core:event` の 3 つだけにした。** `core:default` は使わない。必要になったフェーズで足す
- **`style-src-attr 'none'` を CSP の 2 本両方に入れた。** dev は Vite が `<style>` を差すので `style-src` に `'unsafe-inline'` が必要だが、属性だけは dev でも止められる
- **インライン `style` と生の HTML を差し込む書き方を ESLint の error にした。** スタイルは CSS Modules に寄せる。`innerHTML` 系はブランチ名が外部由来なので塞ぐ。ルールが実際に発火することを確認した
- **整形の hook は入れない。** Write / Edit の直後にファイルを書き換えると、続く Edit の一致対象がずれて編集が失敗する。`pnpm check` の `check:format` で落ちて `pnpm format` で直せるので、仕組みは足さない
- **アプリアイコンは仮のもの。** `scripts/gen-icon.py` で生成している。差し替えるならこのスクリプトを直す
- **capability は空にした。** フロントは `invoke` も `listen` もしないので許可するものが無い。`core:default` も入れない。使う機能が出たフェーズで足す
- **外部サイトへの遷移を拒否する処理を入れた。** CSP にナビゲーションを縛る手段が無いので、Tauri プラグインの `on_navigation` で `tauri:` / `ipc:` と開発時の localhost 以外を落とす。判定は純粋関数にしてユニットテストを 3 本
- **層をまたぐ import を ESLint で縛った。** 順序は `app > features > store > ipc > shared`。フロントを 1 ファイルも書いていないうちに決めた方が安い
- **`pnpm check` に本番ビルドを足した。** CSS の壊れや `index.html` の参照ミスを他の 7 段が誰も読まない
- **cargo に `--locked` を付けた。** `Cargo.lock` のコミット漏れを黙って解決させない
- **バンドルは `.app` だけにした。** `.dmg` の生成は Finder の automation 許可が要る AppleScript を使うので、許可の無い環境で必ず落ちる。署名も公証もしない方針 ([adr/0014-macos-only.md](../adr/0014-macos-only.md)) なので、配布形式が必要になったときに戻す

## 確認した内容

| 項目 | どう確認したか |
| --- | --- |
| `pnpm check` | 実行して 8 段すべて緑 |
| 空のウィンドウ | `pnpm tauri dev` で起動。`CGWindowListCopyWindowInfo` でウィンドウが 1180x760 で存在することを確認 |
| WebView が dev サーバにつながっていること | `lsof -iTCP:1420` で WKWebView のプロセスから 2 本の ESTABLISHED を確認。遷移の拒否と CSP ヘッダが初回読み込みを妨げていない |
| dev に CSP が届いていること | `curl -sI http://localhost:1420/` で `Content-Security-Policy` が返ることを確認 |
| トークンが実行時に解決されること | 18 変数すべてが計算値を持つことを確認 |
| 本番 CSP | 本番ビルドに同じ CSP を差して読み込み、アプリは描画され、`style` 属性だけが無効になることを確認 |
| CSP がどの経路を止めるか | `style` 属性と `setAttribute("style")` は無効、`el.style.x` / `setProperty` / `cssText` は有効。React の `style` prop は CSSOM 経由なので CSP では止まらない |
| macOS 向けビルド | `pnpm tauri build` で `Canopy.app` (9.5MB) ができ、起動して 1180x760 のウィンドウが出ることを確認 |
| Info.plist | `CFBundleIdentifier` `dev.siropaca.canopy` / `LSMinimumSystemVersion` を確認 |
| テストに歯が立っていること | トークンは `--row` を 22px に、DTO は `#[ts(rename_all)]` を単独で足して、どちらも落ちることを確認 |
| 型の出力先を変えても再コンパイルしないこと | 出力先を変えた実行で 0.04 秒・`Compiling` なし。ts-rs は環境変数を実行時に読む |
| リリースビルドの WebView がページを読めていること | `on_page_load` を一時的に足して `tauri://localhost` が `Finished` まで行くことを確認。遷移の拒否が本番の読み込みを妨げていない |

空のウィンドウでの常駐メモリは RSS 83.6MB だった。  
[adr/0001-tauri-react.md](../adr/0001-tauri-react.md) の目標値を測るのはフェーズ 4 だが、出発点として記録しておく。

**ウィンドウのスクリーンショットは撮れていない。** 端末に画面収録の許可が無く、`screencapture` が失敗する ([../pitfalls.md](../pitfalls.md))。  
中身は同じフロントを Chrome で開いて確認した。  
UI を作り込むフェーズ 1 以降は見た目の確認が要になるので、許可を入れておく。

## レビューで出たこと

5 観点 (設定 / セキュリティ / テスト / 設計 / ドキュメント) をサブエージェントに投げた。  
拾えた中で重いものは 3 つ。

- **`pnpm check` に本番ビルドが無かった。** 存在しないファイルの `@import` が 7 段すべてを素通りする
- **dev に CSP が配送されていなかった。** Tauri は `devUrl` を WebView に直接読ませるので `devCsp` が届かない。CSP 違反が本番ビルドまで発覚しない状態だった
- **`innerHTML` に歯止めが無かった。** CSP は `innerHTML` を止めない。ブランチ名は `<` `>` を含められる外部由来の文字列で、コンソール機能が最初の着地点になる

自分が事実を間違えていた点。  
インライン `style` を禁止した理由を「CSP で無効になるから」と書いていたが、React の `style` prop は CSSOM 経由なので CSP では止まらない。  
ルールは残して理由を「スタイルは CSS Modules に寄せる」に直した。

採用しなかった指摘。  
`TS_RS_EXPORT_DIR` を変えるとクレート全体が再コンパイルされるので DTO を別クレートに切るべき、という指摘があったが、実測すると再コンパイルは起きない。  
クレートの分割は保留にした。

次フェーズに移した項目は [phase-1-read.md](phase-1-read.md) の「先に決めること」にある。

## 完了条件

[../workflow.md](../workflow.md) の共通条件に加えて。

- [x] `pnpm check` が通る (8 段)
- [x] `pnpm tauri dev` でウィンドウが出る
- [x] CI が緑

## やらないこと

- git を叩く処理。フェーズ 1 で入れる
- UI の作り込み。トークンの移植だけで、コンポーネントは作らない
