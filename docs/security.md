# セキュリティ

個人ツールでもここは手を抜かない。  
git を子プロセスで実行する以上、外から来た文字列がそのままコマンドに乗る形は作らない。

## IPC の境界

**汎用の「任意の git コマンドを実行する」API をフロントに公開しない。**  
`run_git(args: string[])` のようなコマンドを 1 つ置くと、WebView 側の任意コードがそのまま任意コマンド実行になる。

意図ごとにコマンドを分ける。  
コマンドと git の対応は [specs/git-operations.md](specs/git-operations.md) の表にまとめてある。  
読み取り系も同じ表に載せる。**フロントから呼べるコマンドは、あの表を数えれば全部になる。**

守りたい不変条件は「**フロントから受け取ったパスで git を実行しない**」。

- コマンドの引数はリポジトリの `id` にする。パスを引数に取るコマンドを作らない
- id → パスの対応は Rust 側の store だけが持つ
- **git を実行して良いのは、登録したパスと、そのリポジトリの `worktree list --porcelain` が返したパスだけ。** ワークツリーは登録パスの外にあることが多い (実データでは `~/orca/workspaces/...`)
- 表示やコピーのためにパスを**フロントへ返すのは構わない**。返ってきたパスを引数として受け取らないことが要点

パスを引数に取れる形にすると、登録していないディレクトリで git を実行できてしまう。

Tauri の権限は既定で閉じる。  
使う plugin の capability だけを明示的に許可する。  
`shell` プラグインの汎用実行は有効にしない。

**capability の最小化は自前コマンドの防御にはならない。**  
`#[tauri::command]` で書いたコマンドは、`plugin:` の前置きが無くローカル origin なら ACL を通らずに実行できる (Tauri 2.11 で確認)。  
capability が効くのは plugin のコマンドと `core:` のコマンドだけ。  
自前コマンドを守るのは、このファイルの API 設計 (id しか受け取らない) と CSP と、WebView に外部コードを持ち込ませないこと。

## 外部コマンドの実行

- シェルを経由しない。`tokio::process::Command` に引数を配列で渡す。文字列を組み立てて `sh -c` に流さない
- **`--` を参照名の前に置かない。** `git checkout -- <名前>` は「参照へ切り替え」ではなく「パス `<名前>` をインデックスから復元」になる。ブランチ名とディレクトリ名が同じとき、**未コミットの変更が黙って消えて終了コードは 0**
- オプションの終端は `--end-of-options` を使う。`git checkout --end-of-options -f` は参照 `-f` が無いとしてエラーになる
- 参照の切り替えは `git switch` に寄せる。`git switch` はパスを一切受け付けないので、この事故が構造的に起きない
- **すべての参照引数を共通の検証関数に通す。** 名前変更の新名だけではない。`checkout_branch(repo_id, "-f")` の 1 発で `git checkout -f` になり、ワークツリーの未コミット変更が全部消える
- 通し忘れを型で防ぐ。**書き込みの実行関数は生の `&str` を受け付けない。** 渡せるのはコードに書いた固定文字列、検証を通った `RefName` / `ObjectName`、それらから組み立てた `Composed` だけ ([adr/0017-typed-git-arguments.md](adr/0017-typed-git-arguments.md))
- `Composed::from_git_output` は型では守れない入口。**呼んで良いのは git の出力をパースした直後だけ** (`RepoPath::from_picked_folder` と同じ扱い)
- 検証は `git check-ref-format --branch <名前>` か `refs/heads/<名前>` の完全修飾形で行う。`git check-ref-format <名前>` は完全修飾名を要求するので、`hotfix` のようなスラッシュ無しの正当な名前を弾いてしまう
- `check-ref-format` を通っても、`-` 始まり・`@{` を含む・`..` を含む名前は明示的に拒否する。`--branch '@{-1}'` は妥当な名前として通ってしまう
- 強制プッシュの sha もフロントから来る。16 進数 7〜64 桁だけを通す
- 作業ディレクトリは `Command::current_dir` で明示する。`cd` を挟まない
- 環境変数を固定する。`LC_ALL=C`、`GIT_TERMINAL_PROMPT=0` (認証待ちで固まらせない)、`GIT_OPTIONAL_LOCKS=0` (読み取りでロックを取らない)

## 出力の扱い

- git の stdout / stderr はコンソールに出す。**認証情報が乗る可能性がある行はそのまま出さない**
- リモート URL にトークンが埋まっている構成 (`https://x-access-token:...@github.com/...`) があり得る。**フロントへ返す前に** Rust 側でマスクする (`git::mask_credentials`)
- コンソールの内容をどこにも送信しない。ローカルに閉じる

## ログ

- ログはローカルのファイルにだけ書く
- コマンドと終了コードは記録する。認証情報とトークンは記録しない
- 個人リポジトリのパスとブランチ名は記録して構わない (手元専用のため)

## WebView

- CSP を設定する。外部への接続を許可しない。このアプリは外部にアクセスしない
- **インライン `style` 属性を使わない。** モックはツリーのインデントを `style="--d:N"` で渡しているが、CSP の `style-src` に `'unsafe-inline'` が無いと無効になり階層が全部 0 になる。nonce も hash も style 属性には効かない。実装では `data-depth` 属性 + CSS 側のセレクタか、ref 経由の `setProperty` にする
- `app.security.csp` と開発時の `devCsp` は別に定義する。dev は Vite の HMR が WebSocket を張るので `connect-src` を開ける
- CSP の中身はフェーズ 0 で 2 本とも書き下してから実装に入る。中身は `src-tauri/tauri.conf.json` の `app.security`
- `style-src-attr 'none'` を明示する。dev は Vite が `<style>` を差し込むので `style-src` に `'unsafe-inline'` が必要だが、  
  `style-src-attr` を別に書けば dev でも style 属性だけを止められる  
  WKWebView が `style-src-attr` を解釈することは実測で確認済み
- **外部由来の HTML を差し込まない。** ブランチ名は `<` `>` を含められる。表示は JSX に任せて手組みの HTML を避ける  
  CSP は `innerHTML` を止めないので、`innerHTML` / `outerHTML` / `insertAdjacentHTML` は ESLint で禁止している  
  モックは単体の HTML なので全ての表示値を `esc()` に通している
- **外部サイトへの遷移を拒否する。** CSP にナビゲーションを縛る手段は無い。`Builder::plugin` の `on_navigation` で `tauri:` と `ipc:`、開発時の localhost 以外を落とす  
  遷移してしまうと、そのページが同じ WebView から自前コマンドを叩ける (上の ACL の話)
- **開発時は Vite が CSP を返す。** Tauri は `devUrl` を WebView に直接読ませるので、`devCsp` は `tauri://` を通らない `pnpm tauri dev` には届かない  
  `vite.config.ts` の `server.headers` で `tauri.conf.json` の `devCsp` をそのまま返している。値の情報源は `tauri.conf.json` の 1 箇所
- **CSP が止めるのは「素の style 属性」だけ。** 実測した結果はこうなる

  | 経路 | 本番 CSP 下 |
  | --- | --- |
  | HTML に書いた `style="..."` | 無効 |
  | `setAttribute("style", ...)` | 無効 |
  | `el.style.x = ...` / `setProperty` / `cssText` | **有効** |

  React の `style` prop は CSSOM 経由なので CSP では止まらない。  
  JSX の `style` を ESLint で禁止しているのはスタイルを CSS Modules に寄せるためで、CSP の話ではない
