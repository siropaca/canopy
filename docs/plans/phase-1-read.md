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
- [adr/0005-persistence.md](../adr/0005-persistence.md) — 設定の保存
- [../security.md](../security.md) — **git を実行する対象はコマンド引数の id からのみ解決する。** 表示用にパスをフロントへ返すのは構わない

## 先に決めること

フェーズ 0 のレビューで出た、着手前に片付ける項目。

- [ ] **依存を入れる。追加前に確認を取る** ([../development.md](../development.md) の「依存の追加」)
      Rust は `tokio`。フロントは `zustand`、仮想化 ([../adr/0004-virtual-scroll.md](../adr/0004-virtual-scroll.md))、自前スクロールバー ([../adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md))、`jsdom`、React Testing Library
- [ ] **Vitest の環境を node と jsdom に分ける。** `environmentMatchGlobs` は Vitest 4 で消えていて、書いても無警告で無視される。`test.projects` かファイル先頭の docblock で分ける
- [ ] **モックの `:root` の外にある色をトークンへ昇格させる。** まとめて 1 回で ([../design-system.md](../design-system.md))
- [ ] **CSS Modules のクラス名を型で縛るかを決める。** いまは `styles.typo` が検査を全部通る。`.d.ts` を生成する道具を入れるかどうかの判断

## やること

### Rust 側

- [ ] `run()` からコマンドのハンドラ集合を切り出す。統合テストが `tauri::test::mock_builder()` に同じものを渡せる形にする ([../adr/0013-type-generation.md](../adr/0013-type-generation.md) の「影響」)
- [ ] git を実行する共通処理を書く。引数は配列、シェルを経由しない、環境変数を固定する
- [ ] 読み取りコマンドごとのパーサを書く。ローカルブランチ、リモート、タグ、status、worktree、リモート一覧 (`git remote`)、origin URL
- [ ] `git remote` からリモート名を取って `<リモート名>/<ブランチ>` に分解する。**origin だけとは限らない** (fork があると `upstream/main` が並ぶ)
- [ ] `RepoSnapshot` を組み立てるコマンドを作る。`revision` と `head` (detached を含む) を持たせる
- [ ] Tauri コマンドは `async`、子プロセスは `tokio::process::Command` にする ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md))
- [ ] 取得に失敗したリポジトリを、全体を落とさずに `error` として返す
- [ ] リポジトリの登録・削除・並び順を store に保存する。id を発行してパスと対応させる
- [ ] 登録時に `git rev-parse --git-common-dir` で重複を弾く。ワークツリーを別リポジトリとして登録できてしまうのを防ぐ
- [ ] フォルダ選択ダイアログからリポジトリを追加する
- [ ] 複数リポジトリの読み取りを並列に実行する。同時実行数は読み取り 4 ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md))

### フロント側

- [ ] ipc のラッパは `src/ipc/` 直下、フロント専用の手書き型は `src/ipc/types.ts` に置く。`generated/` は生成物専用 ([../architecture.md](../architecture.md))
- [ ] ストアを `Map<RepoId, RepoState>` にする。loading / ready / error をリポジトリ単位で持つ
- [ ] リポジトリ見出しを全件すぐ描画して、中身は届いた分から埋める。エラーは見出しに理由を出す
- [ ] ツリーを**平坦な行の配列**に変換する純粋関数を書く。**シグネチャをこの時点で確定させる**
      シグネチャは [../architecture.md](../architecture.md) にある
      フェーズ 3 の検索・グループ化・ローカルのみ表示を全部引数として設計しておく。後から足すと呼び出し側を全部直すことになる
- [ ] `query` が空でないときは `expanded` を無視して展開する形にする。**検索の UI はフェーズ 3。** ここで作るのは `flatten` がそう振る舞うことと、そのテストだけ
- [ ] 自前スクロールバー (ネイティブを隠す) を入れて、そのビューポートをスクロール領域にする。**置き場所は `shared/ui/`。** コンソールでも使うのが確定している
- [ ] ツリーを仮想スクロールで描画する ([../adr/0012-scrollbar-and-virtualization.md](../adr/0012-scrollbar-and-virtualization.md))
      仮想リストは行に `style` で位置を渡す。**JSX の `style` は ESLint で禁止しているので、このラッパ 1 箇所だけ理由を書いて `eslint-disable` する**
- [ ] スクロール位置の復元と「選択行までスクロール」を、自前スクロールバーのビューポートに対して実装する
- [ ] 行の描画。リポジトリ見出し / 括り / ディレクトリ / ブランチ / タグ
      **インデントは `data-depth` 属性 + CSS 側のセレクタで出す。** モックの `style="--d:N"` は CSP で無効になる ([../security.md](../security.md))。深さの上限をここで決める
- [ ] インジケーター。`●n` `↙n` `↗n` `gone` `⧉名前` を仕様の順で出す
- [ ] 折りたたみ。親を閉じたら配下も閉じる。状態を保存する
- [ ] 詳細ペイン (表示のみ。ボタンは置くが動かさない)
- [ ] ステータスバー。表示は `features/status-bar/`、集計の計算は `shared/lib/` に出してテストする
- [ ] ツリーと詳細のスプリッタ。`shared/ui/` に置く。幅は `UiState.pane_width`
- [ ] サイドバーの見た目 (ボタンは置くが、展開・折りたたみ以外は動かさない)

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

## 完了条件

- [ ] 実際に自分のリポジトリを 11 個登録して、モックと見比べて差が無い
- [ ] **1.5 秒以内にツリーが出る。** 測るだけにせず目標として扱う。超えたら原因を切り分けて対処する
- [ ] detached HEAD の状態でも表示が崩れない (タグをチェックアウトして確認する)
- [ ] **ネイティブのスクロールバーがどこにも出ていない**
- [ ] 全展開 (約 450 行) でスクロールがつまらない

## やらないこと

- 書き込み操作。フェーズ 2
- 検索、ドラッグ並び替え、コンソール、トースト。フェーズ 3
