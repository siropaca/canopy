# 既知の落とし穴

踏んだものを足していく。  
「直した」だけで終わらせず、ここか仕組みに残す。

## UI の実装

### 仮想リストは「スクロール要素が出来るまで」1 行も描けない

自前スクロールバー (overlayscrollbars) に `defer` を付けると、初期化が  
`requestIdleCallback` 待ちになる。仮想化のスクロール要素はその中のビューポートなので、  
初期化が済むまで行数 0 で描かれる。  
**非アクティブなタブでは idle コールバックが来ない**ので、データは届いているのに  
ツリーが空のまま止まる (実測)。`defer` を付けない。

### 選択のたびに「選択行までスクロール」を呼ぶと先端に飛ぶ

`scrollToIndex` を選択の変更で呼ぶと、クリックしただけでスクロール位置が動く。  
仕様ではクリックは選択だけ (docs/specs/ui.md の「操作」)。  
**行の並びが変わったときだけ**追いかける。判定は行の配列の同一性で行う。

### `[hidden]` が class の `display` に負ける

`.modal { display: flex }` と `<div hidden>` を組み合わせると、要素は隠れない。  
class のルールがブラウザ既定の `[hidden] { display: none }` より強いため。  
必ず `.modal[hidden] { display: none }` を書く。  
モックでこれを踏んで、リロードするたびダイアログが出たままになった。

### `window` の既存プロパティと同名の id を使うと壊れる

`<div id="status">` を作って `status.innerHTML = ...` と書いても効かない。  
`window.status` はレガシーな文字列プロパティで、id による参照が優先されない。  
`document.getElementById()` を使う。  
`status` / `name` / `top` / `length` / `open` / `close` などが該当する。

### 描画用のコピーを書き換えても表示は変わらない

行の描画時に `{...branch, 追加項目}` のようにコピーを作っていると、そのコピーを変更しても元データは変わらない。  
状態を更新するときは必ず元のデータを引き直して書き換える。  
モックでプッシュ後に ahead が 0 にならなかった原因がこれ。

### 選択のたびに再描画するとダブルクリックが成立しない

1 回目の mousedown で DOM を作り直すと、2 回目のクリックのターゲットが別要素になり `dblclick` が発火しない。  
選択の変更は class の付け替えだけにして、構造が変わるときだけ再描画する。

### CSS の特異性が同じなら後に書いた方が勝つ

`.btn.pri` を後に定義してから `.btn.warn` を先に書くと、警告色が当たらない。  
状態のクラスは基本のクラスより後ろに書く。  
迷うなら `.btn.pri.warn` のように両方を含めたセレクタにする。

### `direction: rtl` でパスの先頭がずれる

先頭を省略したくて `direction: rtl` を当てると、`/Users/...` の先頭のスラッシュが末尾に回る。  
パスの省略は普通の `text-overflow: ellipsis` (末尾を省略) にする。

### テーブルのセルでアイコンが切れる

`td { overflow: hidden }` と狭い幅が組み合わさると、中の SVG がクリップされる。  
アイコンを入れる列は `table-layout: fixed` + `colgroup` で幅を確保し、その列だけ `overflow: visible` にする。

## エージェントの運用

### 長時間のサブエージェントは Mac のスリープで全滅する

バックグラウンドのサブエージェントは、実行中に Mac がスリープすると `Your computer went to sleep mid-response` で落ちる。  
5 本並列で投げて 2 回全滅させた。  
数十分かかる作業を投げる前にスリープを止める。

```sh
caffeinate -dis &        # 期限なし。終わったら kill する
```

`caffeinate -i -t 2700` のように期限を付けると、期限切れの後に落ちる。  
期限を付けるなら想定時間の 3 倍を見る。  
それでも席を離れるなら、投げる作業を小さく分けて短時間で返るようにする。

### サブエージェントは確実には終了させられない

終了要求を送っても、本人が `shutdown_response` を返さないと成立しない。  
9 体に送って落ちたのは 1 体だけで、残りは受け取ったあと idle に戻った。  
`ListAgents` にサブエージェントは出ないので、状態の確認もできない。

idle のサブエージェントはトークンを消費せず、セッションが終われば消える。  
見た目の整理のために投げ直すと、8 体それぞれが起きて 1 ターン処理する分のコストがかかる。  
**放置してよい。**

### スクリーンショットには画面収録の許可が必要

`screencapture` は端末に画面収録の許可が無いと `could not create image from window` で失敗する。  
ウィンドウ ID を指定しても領域を指定しても同じ。  
許可が無い環境では、`CGWindowListCopyWindowInfo` でウィンドウの位置とサイズを読んで存在と寸法を確かめ、  
画面の中身はブラウザ (`http://localhost:1420`) 側で確認する。

### 完了通知が来ても報告が届いていないことがある

サブエージェントが完走しても、最終報告がこちらに渡ってこない場合がある。  
`idleReason: available` の通知だけが来て、中身が無い状態。

このとき**エージェントは結果を持っている。**投げ直す前に、名前を指定して「見つけた指摘をもう一度報告してほしい」と送る。  
名前で送れば同じ文脈から再開するので、読み直しも起きない。

`idleReason: failed` (スリープや接続断) と `available` (正常終了) を区別する。  
`available` なら回収できる。

### 表に列を足すと既存の行が壊れる

Markdown の表にヘッダーだけ列を足して行を埋め忘れると、表そのものが崩れる。  
レビュー反映で `IPC` の列を足したときに実際にやった。

`scripts/check-docs.py` の `check_tables()` が列数の不一致を検出する。  
セル内のパイプは `\|` でエスケープする (検査もこの形を除外している)。

### 仕様の定義が死んだ ADR にだけ残ることがある

`flatten()` のシグネチャを ADR-0010 に書いたあと、その ADR を破棄した。  
参照は生きているのに定義は死んだ場所にある、という状態になっていた。

ADR を破棄・置き換えするときは、**その ADR にしか書かれていない定義が無いか**を確認して、生きている場所へ移す。

## git の呼び出し

### 出力形式は固定する

人間向けの出力は git のバージョンと設定で変わる。  
付ける引数と環境変数は [specs/git-operations.md](specs/git-operations.md) の「共通」に集約した。

### `refs/remotes` には `origin` 自体が混ざる

`for-each-ref refs/remotes` は `refs/remotes/origin/HEAD` を短縮した `origin` を返す。  
`/` を含まない参照と `HEAD` で終わる参照を除く。

### `refname:short` は同名のブランチとタグがあると `heads/xxx` を返す

`%(refname:short)` は「曖昧にならない範囲で最短化」なので、`refs/heads/v1.0` と  
`refs/tags/v1.0` が両方あると `heads/v1.0` / `tags/v1.0` になる (実測)。

その名前は git に渡せず (`fatal: a branch is expected`)、`worktree list` が返す  
`refs/heads/v1.0` とも一致しないので `⧉` の紐づけも切れる。  
`%(refname:lstrip=2)` を使う。`refs/remotes` でも `origin/main` になる。

### コミットを指さない軽量タグは日時を持たない

`git tag x <tree の sha>` のようなタグは `creatordate` も `committerdate` も空。  
日時が空の行をエラーにしていると、そのタグ 1 本でリポジトリのスナップショットが  
丸ごと落ちる (実測)。

`%(objecttype)` と `%(*objecttype)` を format に足して、commit に解決しない ref は落とす。  
タグとしてチェックアウトもできないので、載せる意味が無い。

### bare リポジトリとサブディレクトリは `--git-common-dir` では弾けない

`git rev-parse --git-common-dir` は bare でも成功する (`.` を返す) ので、  
登録の入口の判定には使えない。登録できてしまうと `git status` が毎回 exit 128 で落ちる。

リポジトリのサブディレクトリを選んだ場合はもっと厄介で、`worktree list` が返す  
最上位が「別のワークツリー」として残り、**現在のブランチに `⧉` が付く** (実測)。  
`git rev-parse --show-toplevel` を使えば、bare を弾くのと最上位への正規化を 1 回で両立できる。

### URL の認証情報は最後の `@` で切る

`split_once('@')` だと、パスワードに `@` が入っている URL でパスワードの断片が残る。  
git と curl は authority の最後の `@` を区切りとして扱う。`rsplit_once('@')` にする。

### `[gone]` は追跡ブランチが消えた状態

`upstream:track` が `[gone]` のブランチは、リモート側が消えている。  
マージ済みで削除されたブランチが手元に残っている状態なので、掃除の対象として見せる価値がある。  
behind / ahead とは別の状態として扱う。

### 同一リポジトリで git を並列実行すると失敗する

`index.lock` が競合する。  
リポジトリごとに直列のキューを通す。

### 未コミットの状態はリポジトリ単位ではなくワークツリー単位

`git worktree` を使っていると、リンクされたワークツリーはそれぞれ独立した変更を持つ。  
`git status` はメインのワークツリーの分しか返さない。  
ワークツリーごとに実行して、対応するブランチに紐づける。

### プルとプッシュが失敗する典型を握りつぶさない

- 未コミットの変更があると `git pull --rebase` は `cannot pull with rebase` で失敗する
- リモートが進んでいると push は `non-fast-forward` で拒否される

どちらも「よくある失敗」なので、失敗そのものを見せて次の手を選べるようにする。  
自動で stash したり force したりしない。

### 強制プッシュは `--force-with-lease`。ただし sha を明示する

`--force` は他人の push を消す。  
強制が必要な場面でも `--force-with-lease` を使う。

**値なしの `--force-with-lease` は手元の追跡 ref を基準にするので、フェッチした直後は無意味になる。**  
「すべてフェッチ」→「強制プッシュ」の順に押すだけで、他人のコミットを消せる (実測)。  
ユーザーが画面で見ていた sha を `--force-with-lease=<名前>:<sha>` で明示する。

ahead が 0 で behind があるブランチへの強制プッシュは、リモートを巻き戻すだけの操作になる。  
UI 側でチェックボックスを無効にする。

### `git checkout -- <名前>` は未コミットの変更を消す

オプションと値を分離するつもりで `--` を参照名の前に置くと、意味が変わる。  
`git checkout -- docs` は「`docs` ブランチへ切り替え」ではなく「パス `docs` をインデックスから復元」。

ブランチ名とディレクトリ名が同じとき、**未コミットの変更が黙って消えて終了コードは 0**。  
git は何も出力しないのでコンソールにも残らない。

参照の切り替えは `git switch` を使う。`git switch` はパスを受け取らないので構造的に起きない。  
オプションの終端は `--end-of-options`。

### `git check-ref-format` は完全修飾名を要求する

`git check-ref-format hotfix` は exit 1。スラッシュ無しの正当なブランチ名を弾いてしまう。  
`--branch` を付けるか `refs/heads/<名前>` の形で渡す。

`--branch` を通しても `@{-1}` のような表記は妥当な名前として通る。  
`-` 始まり・`@{` を含む・`..` を含む名前は明示的に拒否する。

### リモートブランチのチェックアウトは同名ローカルにすり替わる

`git checkout <origin を除いた名前>` は、同名のローカルブランチがあればそれに切り替えるだけ。  
追跡ブランチは作られず、リモートの先端にも乗らない。終了コードは 0 で出力も成功と同じ。

ローカルに無ければ `git switch -c <名前> --track <リモート>/<名前>`、あれば「既存のローカルに切り替えた」と UI に出す。

### `git branch -m` は追跡先を旧名のまま残す

`branch.<新>.merge` が旧名を指し続ける。  
そのままプッシュすると origin 側に旧名と新名が両方でき、ahead も減らない。  
名前を変えたら `git branch --unset-upstream <新>` か `git push -u origin <新>` で貼り直す。

### 同じ文字列の失敗が操作によって逆の意味になる

`! [rejected] ... (non-fast-forward)` はプッシュなら「リモートが進んでいる」、  
プル (`fetch origin x:x`) なら「手元が進んでいる」。  
文字列だけで判定すると、プルしたのに「プッシュが拒否されました」と表示される。  
判定は「操作の種別 × 出力」で行う。

### ワークツリーを別リポジトリとして登録できてしまう

リンクされたワークツリーも `rev-parse --is-inside-work-tree` が true を返し、`remote get-url` も通る。  
別々に登録すると直列キューが分かれ、同じ `refs/remotes/origin/*` を同時に更新して  
`unable to update local ref` で片方が落ちる (実測)。

同一性は `git rev-parse --git-common-dir` の実パスで判定する。キューのキーもこれにする。

### タグと同名のブランチがあると detach しない

`git checkout v1.0` は `warning: refname 'v1.0' is ambiguous` を出してブランチに切り替わる。  
タグを detached でチェックアウトするなら `git checkout --detach refs/tags/<名前>` を使う。

## ツールチェインと設定

### `tauri icon` は macOS 以外の画像も作る

`pnpm tauri icon` は iOS・Android・Windows の画像まで生成する。  
macOS だけを対象にしているので ([adr/0014-macos-only.md](adr/0014-macos-only.md))、  
`android/` `ios/` `icon.ico` `Square*.png` `StoreLogo.png` は消す。  
残すのは `32x32.png` `128x128.png` `128x128@2x.png` `icon.icns` と元画像。  
`icon.png` (Linux 向けの 512x512) も `tauri.conf.json` から参照しないので消す。

### WebView の中に何が出ているかは `on_page_load` で確かめる

画面収録の許可が無いとスクリーンショットが撮れず、ウィンドウが白いのか描画済みなのかが分からない。  
`Builder::on_page_load` で `payload.url()` と `payload.event()` を stderr に出せば、読み込みが `Started` で止まったのか `Finished` まで行ったのかが分かる。

ログを見るには**バンドルの中の実体**を直接起動する。

```sh
src-tauri/target/release/bundle/macos/Canopy.app/Contents/MacOS/canopy
```

`open -a` は切り離されるので stderr が取れない。  
`target/release/canopy` (バンドル外) を叩くと、macOS がアプリとして扱わずウィンドウが出ない。

### `.dmg` のバンドルは Finder の automation 許可が要る

`tauri build` の `dmg` ターゲットは `bundle_dmg.sh` が AppleScript で Finder のウィンドウを整える。  
許可が無い環境では `.app` の生成まで成功してから `failed to run bundle_dmg.sh` で落ちる。  
`bundle.targets` を `["app"]` にしておけば起きない。

### mise が入れた Rust には rustfmt と clippy が付いてこない

手元では入っているので気づかないが、CI では
`error: 'cargo-fmt' is not installed for the toolchain '1.98.0-aarch64-apple-darwin'`
で `pnpm check` の最後の段が落ちる。

`mise.toml` の `profile = "default"` だけでは足りない。  
CI に `rustup component add rustfmt clippy` の 1 段を置く。  
**検査ではなく用意なので、CI 側に書いてよい。**

### dev-dependencies の feature が本体のビルドを騙す

`cargo test` と `cargo clippy --all-targets` は dev-dependencies を含めて解決するので、  
同じクレートを `[dependencies]` と `[dev-dependencies]` の両方に書くと **feature が合成される。**  
`tokio` の `macros` を dev 側だけに書いて `tokio::try_join!` を実装で使ったところ、  
`cargo test` と clippy は通ったのに `pnpm tauri dev` のビルドだけが  
`could not find try_join in tokio` で落ちた。

`pnpm check` に `cargo check --locked` を足して、dev-dependencies の入らないビルドを  
1 回通すようにした。実装で使う feature は `[dependencies]` に書く。

### TypeScript 7 は typescript-eslint がまだ対応していない

`typescript` の `latest` は 7 系だが、typescript-eslint の peer は `<6.1.0`。  
7 を入れると型を見る lint ルール (`recommendedTypeChecked`) が全部使えなくなる。  
`typescript` は 6.0.x に**キャレット無しで**固定する。  
`^6.0.3` だと 6.1 に上がって範囲から出る。

### `baseUrl` は TypeScript 6 で deprecated

`paths` は `baseUrl` 無しで書く。  
値は tsconfig からの相対 (`"@/*": ["./src/*"]`)。  
`baseUrl` を残すと `TS5101` でコンパイルが止まる。

### `noPropertyAccessFromIndexSignature` は CSS Modules と噛み合わない

`vite/client` の型定義は `*.module.css` を `{ readonly [key: string]: string }` として宣言している。  
このオプションを入れると `styles.app` が `TS4111` で落ち、`styles["app"]` と書くしかなくなる。  
アンビエント宣言なので上書きもできない。  
型で縛るのは諦めて、参照と定義を突き合わせるテストを置いた (`src/test/css-modules.test.ts`)。  
`styles.typoo` と、使っていないクラスの両方を落とす。`.d.ts` を生成する道具は入れていない。

### `eslint-plugin-react-hooks` の flat config は入れ子になっている

`configs.recommended` と `configs["recommended-latest"]` はどちらも eslintrc 形式で、flat config に渡すと  
`"plugins" を配列で書いている` というエラーになる。  
flat 用は `configs.flat["recommended-latest"]`。

### Prettier に `docs/` を整形させるとモックが壊れる

`docs/mock/tree.tmpl.html` は意図して詰めて書いてある。  
整形すると差分が全面に出て、モックを参照元にしている意味が薄れる。  
`.prettierignore` で `*.md` と `docs/` を外す。
