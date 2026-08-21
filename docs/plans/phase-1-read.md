# フェーズ 1: 読み取り

## 目的

リポジトリを登録すると、モックと同じツリーが表示される状態にする。  
操作 (チェックアウトなど) はまだ無く、見えるだけ。

## 前提

- [../specs/data-model.md](../specs/data-model.md) — 型
- [../specs/git-operations.md](../specs/git-operations.md) の「読み取り」 — コマンド
- [../specs/ui.md](../specs/ui.md) の「ツリー」「詳細ペイン」「ステータスバー」 — 表示
- [adr/0004-virtual-scroll.md](../adr/0004-virtual-scroll.md) — 平坦化して仮想化する
- [adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md) — 自前スクロールバー
- [adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md) — 並行モデル
- [adr/0016-store-without-plugin.md](../adr/0016-store-without-plugin.md) — 設定の保存
- [../security.md](../security.md) — **git を実行する対象はコマンド引数の id からのみ解決する。** 表示用にパスをフロントへ返すのは構わない

## 先に決めること

フェーズ 0 のレビューで出た、着手前に片付ける項目。

- [x] **依存を入れる。追加前に確認を取る** ([../development.md](../development.md) の「依存の追加」)
      Rust は `tokio`。フロントは `zustand`、仮想化 ([../adr/0004-virtual-scroll.md](../adr/0004-virtual-scroll.md))、自前スクロールバー ([../adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md))、`jsdom`、React Testing Library
- [x] **Vitest の環境を node と jsdom に分ける。** `environmentMatchGlobs` は Vitest 4 で消えていて、書いても無警告で無視される。`test.projects` かファイル先頭の docblock で分ける
- [x] **モックの `:root` の外にある色をトークンへ昇格させる。** まとめて 1 回で ([../design-system.md](../design-system.md))
- [x] **CSS Modules のクラス名を型で縛るかを決める。** いまは `styles.typo` が検査を全部通る。`.d.ts` を生成する道具を入れるかどうかの判断

## やること

### Rust 側

- [x] `run()` からコマンドのハンドラ集合を切り出す。統合テストが `tauri::test::mock_builder()` に同じものを渡せる形にする ([../adr/0013-type-generation.md](../adr/0013-type-generation.md) の「影響」)
- [x] git を実行する共通処理を書く。引数は配列、シェルを経由しない、環境変数を固定する
- [x] 読み取りコマンドごとのパーサを書く。ローカルブランチ、リモート、タグ、status、worktree、リモート一覧 (`git remote`)、origin URL
- [x] `git remote` からリモート名を取って `<リモート名>/<ブランチ>` に分解する。**origin だけとは限らない** (fork があると `upstream/main` が並ぶ)
- [x] `RepoSnapshot` を組み立てるコマンドを作る。`revision` と `head` (detached を含む) を持たせる
- [x] Tauri コマンドは `async`、子プロセスは `tokio::process::Command` にする ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md))
- [x] 取得に失敗したリポジトリを、全体を落とさずに `error` として返す
- [x] リポジトリの登録・削除・並び順を store に保存する。id を発行してパスと対応させる
- [x] 登録時に `git rev-parse --git-common-dir` で重複を弾く。ワークツリーを別リポジトリとして登録できてしまうのを防ぐ
- [x] フォルダ選択ダイアログからリポジトリを追加する
- [x] 複数リポジトリの読み取りを並列に実行する。同時実行数は読み取り 4 ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md))

### フロント側

- [x] ipc のラッパは `src/ipc/` 直下、フロント専用の手書き型は `src/ipc/types.ts` に置く。`generated/` は生成物専用 ([../architecture.md](../architecture.md))
- [x] ストアを `Map<RepoId, RepoState>` にする。loading / ready / error をリポジトリ単位で持つ
- [x] リポジトリ見出しを全件すぐ描画して、中身は届いた分から埋める。エラーは見出しに理由を出す
- [x] ツリーを**平坦な行の配列**に変換する純粋関数を書く。**シグネチャをこの時点で確定させる**
      シグネチャは [../architecture.md](../architecture.md) にある。  
      フェーズ 3 の検索・グループ化・ローカルのみ表示を全部引数として設計しておく。後から足すと呼び出し側を全部直すことになる
- [x] `query` が空でないときは `expanded` を無視して展開する形にする。**検索の UI はフェーズ 3。** ここで作るのは `flatten` がそう振る舞うことと、そのテストだけ
- [x] 自前スクロールバー (ネイティブを隠す) を入れて、そのビューポートをスクロール領域にする。**置き場所は `shared/ui/`。** コンソールでも使うのが確定している
- [x] ツリーを仮想スクロールで描画する ([../adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md))
      仮想リストは行に `style` で位置を渡す。**JSX の `style` は ESLint で禁止しているので、このラッパ 1 箇所だけ理由を書いて `eslint-disable` する**
- [x] スクロール位置の復元と「選択行までスクロール」を、自前スクロールバーのビューポートに対して実装する
- [x] 行の描画。リポジトリ見出し / 括り / ディレクトリ / ブランチ / タグ
      **インデントは `data-depth` 属性 + CSS 側のセレクタで出す。** モックの `style="--d:N"` は CSP で無効になる ([../security.md](../security.md))。深さの上限をここで決める
- [x] インジケーター。`●n` `↙n` `↗n` `gone` `⧉名前` を仕様の順で出す
- [x] 折りたたみ。親を閉じたら配下も閉じる。状態を保存する
- [x] 詳細ペイン (表示のみ。ボタンは置くが動かさない)
- [x] ステータスバー。表示は `features/status-bar/`、集計の計算は `shared/lib/` に出してテストする
- [x] ツリーと詳細のスプリッタ。`shared/ui/` に置く。幅は `UiState.pane_width`
- [x] サイドバーの見た目 (動くのは展開・折りたたみと、リポジトリの追加・削除)

## テスト

| 層 | 内容 |
| --- | --- |
| Rust ユニット | 各パーサ。`[gone]` / `[ahead n, behind m]` / 空 / 想定外の行 |
| Rust ユニット | `refs/remotes` から `/` を含まない参照と `HEAD` で終わる参照を除くこと。origin 以外のリモートを正しく分解すること |
| Rust ユニット | 重複判定。ワークツリーのパスを登録しようとしたら弾くこと |
| Rust 統合 | 一時リポジトリを作って `RepoSnapshot` が正しくできること。behind / ahead / 未コミット / gone / ワークツリーの各状態 |
| フロント ユニット | 平坦化。折りたたみ、グループ化のオンオフ、深い階層、検索が `collapsed` を汚さないこと |
| フロント ユニット | 古い `revision` のスナップショットを捨てること |
| コンポーネント | 行の描画。インジケーターの有無と順序 |

フィクスチャのヘルパーはここで作る。以降のフェーズで使い回す。  
`src-tauri/tests/support/mod.rs` の先頭に `#![allow(dead_code)]` を置く。  
`tests/` の各ファイルは別クレートなので、使っていないヘルパーが `dead_code` になって `clippy -D warnings` で落ちる。


## 決めたこと

入れた依存 (承認済み)。

| パッケージ | 何のために |
| --- | --- |
| `zustand` | ストア ([../adr/0003-state-and-styling.md](../adr/0003-state-and-styling.md)) |
| `@tanstack/react-virtual` | 仮想スクロール ([../adr/0004-virtual-scroll.md](../adr/0004-virtual-scroll.md)) |
| `overlayscrollbars` / `overlayscrollbars-react` | 自前スクロールバー ([../adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md)) |
| `jsdom` / `@testing-library/react` | コンポーネントテスト |
| `tokio` (`macros` / `process` / `sync`) | 子プロセスと排他 ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md)) |
| `tauri-plugin-dialog` | フォルダ選択を Rust 側で開く ([../security.md](../security.md)) |
| `tempfile` (dev) | 統合テストの一時リポジトリ |
| `tauri` の `test` feature (dev) | `mock_builder` でコマンドを IPC 越しに叩く |

`dnd-kit` は入れていない。ドラッグ並び替えはフェーズ 3。

決めたこと。

- **設定は store プラグインを使わず `serde_json` で読み書きする。** 理由は [../adr/0016-store-without-plugin.md](../adr/0016-store-without-plugin.md)
- **Vitest の環境は拡張子で分けた。** `*.test.ts` は node、`*.test.tsx` は jsdom。`test.projects` で 2 つに分け、分かれていることをテストで固定した (`src/test/environment-*.test.*`)
- **CSS Modules のクラス名は自作テストで縛った。** 生成ツールを入れず、`styles.foo` の参照と隣の `*.module.css` の定義を突き合わせる (`src/test/css-modules.test.ts`)。使っていないクラスと動的な `styles[key]` も落とす
- **モックの `:root` の外の色を 37 個トークンへ昇格させた。** 全 55 トークン。影とオーバーレイの黒は「色ではなく効果」なのでトークンにしない
- **`RepoPath` を作れるのは `store` だけにした。** 登録済みのリポジトリ、その `worktree list` が返したパス、OS のフォルダ選択が返した値の 3 経路しかない ([../security.md](../security.md))
- **`shared` から `ipc/types.ts` の型 import だけ許した。** `flatten()` が `RepoState` を受け取るため。実行時の import は今までどおり禁止 (`allowTypeImports`)
- **`i64` / `u64` を `bigint` ではなく `number` で生成する。** `.cargo/config.toml` の `TS_RS_LARGE_INT`。IPC は JSON なので実行時は number で届き、`bigint` と宣言すると型が嘘になる
- **コマンドの引数名は `rename_all = "snake_case"`。** DTO が snake_case なので、既定の camelCase と混ざるのを避ける
- **既定の展開を当てるのは登録した瞬間だけ。** 毎回当てるとユーザーが閉じた状態が起動のたびに戻る ([../specs/data-model.md](../specs/data-model.md))
- **インデントの上限は 12 段。** `data-depth="0"` から `12` までの CSS を持ち、それより深い行は同じ位置に出す
- **並び順は `Intl.Collator("ja", { numeric: true })`。** `rec-2` が `rec-10` より先に来る
- **リポジトリを追加できなかった理由は OS のダイアログで見せる。** トーストはフェーズ 3 なので、それまでの見せ方。理由はフロントにも返す
- **サイドバーのツールチップは `title` 属性にした。** モックのような自前の吹き出しはフェーズ 4 (見た目の詰め) に回した
- **`pnpm check` に `cargo check` を足した。** dev-dependencies の feature が合成されて本体のビルドだけが落ちる状態を見逃していた ([../pitfalls.md](../pitfalls.md))

## 確認した内容

| 項目 | どう確認したか |
| --- | --- |
| `pnpm check` | 8 段すべて緑 (フロント 186 / Rust 122 テスト) |
| パーサのテストに歯が立っていること | 実装を 13 通り機械的に壊して、全部テストが落ちることを確認した |
| git の出力形式 | 一時リポジトリで実測。annotated タグは `committerdate` が空、`refs/remotes` に `origin` が混ざる、`status -z` の改名は 2 区画、`worktree list -z` はレコードの終わりが空区画 |
| 実データでの表示 | 自分のリポジトリ 11 個を登録して起動。ローカル 27 / リモート 235 / worktree 1 |
| モックとの一致 | モックと同じデータをフロントに食わせて突き合わせた。ツリー・ステータスバー・詳細ペインとも一致 |
| 1.5 秒以内にツリーが出る | リリースビルドで測定。**11 リポジトリすべてが 0.96 秒**で届く (最初の 1 件は 0.67 秒) |
| detached HEAD | 見出しに `detached: v1.0.3` が出て、どのブランチにもタグアイコンが付かないことを確認 |
| ネイティブのスクロールバー | ツリーのビューポートで `offsetWidth - clientWidth = 0`、`scrollbar-width: none`。自前のつまみは 10px の枠に 6px |
| 全展開でのスクロール | 459 行に対して DOM の行は 53。スクロールしても引っかからない |
| スプリッタ | 360 → 410 → 262 px と追従することを確認 |
| Finder からの起動 | `.app` を `open -a` で起動して、実データのツリーが出ることを確認 (git の PATH を明示しているため) |

## レビューで出たこと

5 観点をサブエージェントに投げた (仕様の一致 / 正しさ / テスト / 設計 / ドキュメント)。  
指摘は 61 件 (仕様 8 / 正しさ 7 / テスト 14 / 設計 17 / ドキュメント 15)。  
採用 50 件、次フェーズに持ち越し 6 件、レビュー前に自分で直していた分 3 件、見送り 2 件。

### 表に出る不具合として直したもの

- **`%(refname:short)` は同名のブランチとタグがあると `heads/v1.0` を返す。** git に渡せない名前になり、`⧉` の紐づけも切れる。`lstrip=2` に変えた
- **コミットを指さない軽量タグ 1 本で、リポジトリのスナップショットが丸ごと落ちる。** `objecttype` で落とすようにした
- **bare リポジトリとサブディレクトリが登録できてしまう。** 前者は読み取りが毎回失敗し、後者は現在のブランチに `⧉` が付く。`--show-toplevel` で弾く / 最上位に正規化する
- **パスワードに `@` が入った URL で認証情報の断片が画面に出る。** `rsplit_once` に変えた
- **起動直後に合計が `0` → `-` → 確定と 3 段跳ねる。** 「まだ読んでいない」を状態として持たせた
- **detached HEAD と `gone` で「選択対象をプル」が有効なまま。** `canPullSelection()` に切り出した
- **読み込み中とエラーのリポジトリを選ぶと詳細ペインが空になる。** 壊れたリポジトリを外す導線が消えていた
- **古い失敗が新しいスナップショットを消せる。** 失敗には世代が付かないので、要求の番号で最後の 1 本だけを採る
- **終了直前の UI 状態がデバウンスに飲まれて保存されない。** 片付けで書き出す
- 自前スクロールバーの `defer` でツリーが 1 行も出ない / 選択でツリーが先頭に飛ぶ (この 2 件はレビュー前に自分で見つけて直した)

### 仕組みに落としたもの

テストレビューは「実装を 60 通り壊して落ちるか」で検証し、20 通りが素通りしていた。  
落ちなかったものは全部テストを足して、同じ壊し方で落ちることを確認した。

- **フロントが送る invoke の引数名**を Rust のコマンド定義と突き合わせる (`{ repoId }` に書き換えたら落ちる)
- **git に渡す環境変数**を一覧として切り出して固定 (`LC_ALL` / `GIT_TERMINAL_PROMPT` / `GIT_SSH_COMMAND` / `GIT_DIR` の除去)
- **未コミット一覧の件数**を Rust の 21 とフロントの 20 で突き合わせる
- **インデントの段数**を `MAX_DEPTH` と CSS の `[data-depth]` で突き合わせる
- 鍵の `|` 境界 (`r1` と `r10`)、ブランチ名に `|` を含む場合、保存失敗時のロールバック、アトミック書き込み、`run_ok` の失敗経路、`fetched_at`、見出しを薄くする / 選択を塗る、検索の大文字小文字と前後の空白

### 次フェーズに持ち越したもの

いま直すと呼び出し元が 1 つしか無い状態で形を決めることになるので、条件付きで [phase-2-write.md](phase-2-write.md) と [phase-3-around.md](phase-3-around.md)、[phase-4-polish.md](phase-4-polish.md) に書いた。

- 並行制御の合成を 1 箇所に出す (書き込みが 6〜7 本乗るとき)
- `commands/repo.rs` の分割
- 「画面に見えている選択」を `store/` のフックに出す
- `flatten` をリポジトリ単位に切り出してメモ化する (検索の性能要件と一緒に)
- behind / ahead / 未コミットのチップの共通部品化 (モックが 3 箇所で別デザインなので、見た目の詰めと一緒に判断)
- スプリッタのドラッグ中の再描画を測る

### 見送ったもの

- **`Sidebar` を props ではなくストア直読みにする。** 他の features と形が違うのは事実だが、props のままの方がコンポーネント単体でテストしやすい。展開系のアクションだけ `store/treeActions.ts` に出して「置き場所の基準が 2 通り」は解消した
- **`isDetached()` の切り出し。** `head.kind === "detached"` の 1 行で、文言は仕様上 2 箇所で違う

次の 3 つは「採用したが、縛れる範囲に限った」もの。

- **`ScrollArea` の内部。** jsdom では overlayscrollbars が初期化しないので、テストで縛れるのは「子が描かれること」まで。つまみの寸法と色はブラウザでの実測に寄せた
- **`stdin(Stdio::null())`。** 環境変数は一覧にして固定したが、標準入力の閉じ方は振る舞いとして安定に確かめられない
- **StrictMode で `loadEverything` が 2 回走ること。** dev だけの挙動 (本番では 1 回) なので、ガードは足さずに計測時の注意として記録した

## 完了条件

- [x] 実際に自分のリポジトリを 11 個登録して、モックと見比べて差が無い
- [x] **1.5 秒以内にツリーが出る。** リリースビルドで 0.96 秒 (dev ビルドは 1.36 秒)
- [x] detached HEAD の状態でも表示が崩れない (タグをチェックアウトして確認する)
- [x] **ネイティブのスクロールバーがどこにも出ていない**
- [x] 全展開 (459 行) でスクロールがつまらない

## やらないこと

- 書き込み操作。フェーズ 2
- 検索、ドラッグ並び替え、コンソール、トースト。フェーズ 3

`flatten` は検索・グループ化・ローカルのみ表示を実装済みだが、**それを操作する UI は出していない。**  
検索欄とサイドバーのトグルはフェーズ 3。自前の吹き出しツールチップはフェーズ 4。
