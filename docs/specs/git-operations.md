# git 操作

安全に呼ぶための決まりは [../security.md](../security.md) にある。  
ここでは「どの操作でどのコマンドを実行するか」を定める。

## 共通

すべての実行に付ける。

- 作業ディレクトリはリポジトリのパス (id から解決する)
- 環境変数 `LC_ALL=C` / `GIT_TERMINAL_PROMPT=0` / `GIT_OPTIONAL_LOCKS=0`
- `GIT_SSH_COMMAND="ssh -o ConnectTimeout=5 -o BatchMode=yes"`。これが無いと接続不能時に 1 本あたり 75 秒ブロックする
- `PATH` は明示的に組み立てる。`.app` を Finder から起動すると launchd の最小 PATH になり、ターミナルから `pnpm tauri dev` したときと環境が違う。**動作確認はビルドした `.app` を Finder から起動して行う**
- 色を止める。`-c color.ui=false` を付ける (`--no-color` はサブコマンドごとのオプションなので共通では使えない)
- 引数は配列で渡す。シェルを経由しない
- **標準入力を閉じる** (`Stdio::null`)。認証やエディタの待ちで固まらせない
- **`GIT_DIR` と `GIT_WORK_TREE` を消す。** 呼び出し元のシェルに残っていると別のリポジトリを触る
- 参照を渡すコマンドには `--end-of-options` を挟む
- 出力形式を固定する。`--porcelain` / `for-each-ref --format` / `log --format`
- `-c core.quotepath=false` を付ける。日本語のパスがエスケープされるのを防ぐ
- パスを含む出力は `-z` (NUL 区切り) を優先する。ファイル名に空白や改行が入っても壊れない
- 参照の切り替えは `git switch` を使う。`git checkout` はパスも受け取るので事故が起きる ([../security.md](../security.md))
- すべての参照引数を共通の検証関数に通す

## 読み取り

フロントから呼ぶのは `get_repo_snapshot(repo_id)` の 1 本だけ。  
下の表はその中で実行するコマンド。**リポジトリ 1 件分をまとめて 1 回の invoke で返す。**

| 目的 | コマンド |
| --- | --- |
| 現在のブランチ | `git branch --show-current` |
| ローカルブランチ | `git for-each-ref refs/heads --format=<名前/追跡状態/日時>` |
| リモート追跡ブランチ | `git for-each-ref refs/remotes --format=<名前/日時>` |
| タグ | `git for-each-ref refs/tags --format=<名前/日時>` |
| 未コミット | `git status --porcelain` |
| ワークツリー | `git worktree list --porcelain` |
| 直近のコミット | `git log -5 --format=<hash/subject> <ブランチ>` |
| origin の URL | `git remote get-url origin` |
| リモートの一覧 | `git remote` |
| detached のときの参照名 | `git describe --tags --exact-match HEAD` → 失敗したら `git rev-parse --short HEAD` |
| 実体の .git ディレクトリ | `git rev-parse --git-common-dir` |
| ワークツリーの最上位 | `git rev-parse --show-toplevel` |
| 最後の fetch の時刻 | git を使わない。`<--git-common-dir>/FETCH_HEAD` の mtime を読む |

`git remote` を取るのは、リモートが origin だけとは限らないため。  
fork を持つリポジトリでは `upstream/main` のような参照が `refs/remotes` に並ぶ。  
「origin を除いた名前」で処理すると壊れる。

`--git-common-dir` はリポジトリの同一性の判定に使う。詳細は下の「重複の判定」。

読み取りはリポジトリを跨いで並列に投げてよい。  
ただし**同一リポジトリの書き込み中は待たせる** ([../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md))。

`worktree list --porcelain` から落とすのは `prunable` / `locked` / `bare` / detached の 4 つ。  
消えたワークツリーで `git status` を実行すると失敗する。  
detached はどのブランチにも紐づけられないので載せない ([data-model.md](data-model.md) の `Worktree`)。

**日時は `creatordate` で取る。** annotated タグは `committerdate` が空になる (実測)。  
`refs/heads` は最終コミットの日時が欲しいので `committerdate` のままでよい。

パスを含む出力は `-z` を付ける。`worktree list --porcelain -z` は  
区画を NUL で区切り、レコードの終わりを空の区画で表す (実測)。

`for-each-ref refs/remotes` の結果からは `/` を含まない参照と `HEAD` で終わる参照を除く。  
`refs/remotes/origin/HEAD` が `origin` として混ざる。

## 書き込み

同一リポジトリでは直列に実行する。

`IPC` の列は、フロントから呼ぶ Tauri コマンド名。  
**汎用の「任意の git を実行する」コマンドは作らない** ([../security.md](../security.md))。

| 操作 | IPC | コマンド | 前提 |
| --- | --- | --- | --- |
| フェッチ | `fetch_repo` | `git fetch --prune` | — |
| プル (現在のブランチ) | `pull_current` | `git pull --rebase` | 未コミットが無いこと。**`pull.rebase` の設定を見ずに常に rebase する** (このツールの方針) |
| プル (他のローカルブランチ) | `fast_forward_branch` | `git fetch origin <名前>:<名前>` | チェックアウトせずに早送りする。早送りできないときは失敗する |
| チェックアウト | `checkout_branch` | `git switch --end-of-options <名前>` | ローカルブランチに切り替える |
| チェックアウト (リモート・ローカルに無い) | `checkout_branch` | `git switch -c <ブランチ> --track <リモート>/<ブランチ>` | 追跡ブランチを作る。ローカルの有無は Rust 側で判定して分岐する |
| チェックアウト (リモート・ローカルに有る) | `checkout_branch` | `git switch --end-of-options <ブランチ>` | **既存のローカルに切り替わるだけ。リモートの先端には乗らない。** そのことを UI に明示する |
| チェックアウト (タグ) | `checkout_tag` | `git checkout --detach refs/tags/<タグ名>` | detached HEAD にする |
| チェックアウトとプル | `checkout_and_pull` | `git switch <名前>` → `git pull --rebase` | 前が失敗したら止める |
| プッシュ | `push_branch` | `git push origin <名前>` | — |
| プッシュ (追跡なし) | `push_branch` | `git push -u origin <名前>` | 追跡ブランチが無いとき |
| 強制プッシュ | `push_branch` | `git push --force-with-lease=<名前>:<sha> origin <名前>` | `--force` は使わない。**sha を明示する**。ahead が 0 のときは UI 側で禁止する |
| ブランチ名の変更 | `rename_branch` | `git branch -m <旧> <新>` → `git branch --unset-upstream <新>` | `-m` は `branch.<新>.merge` を旧名のまま残す。追跡を外さないと、プッシュで origin 側に旧名と新名が両方できる |
| 直前のブランチに戻る | `checkout_previous` | `git checkout -` | detached HEAD から戻るときに使う |

プッシュは 3 行あるが IPC は 1 つ。`force_with_lease` の引数で分岐する。  
チェックアウトも同様に、ローカルの有無を Rust 側で判定する。フロントが分岐を持たない。

### git を使わない操作

| 操作 | IPC | 実装 |
| --- | --- | --- |
| リポジトリの一覧 | `list_repos` | store から id・名前・パスを返す。git は実行しない |
| UI 状態の読み込み | `get_ui_state` | store から返す |
| リポジトリの状態 | `get_repo_snapshot` | 上の「読み取り」の表を実行して `RepoSnapshot` を組み立てる |
| リポジトリを追加 | `add_repo` | Rust 側でフォルダ選択ダイアログを開く。パスがフロントを経由しない |
| リストから削除 | `remove_repo` | store から消すだけ。ディスクには触らない |
| 並び順の変更 | `save_ui_state` | 専用のコマンドは持たない。`UiState.repo_order` に載せて保存する |
| Finder で表示 | `reveal_in_finder` | `open -R <パス>` |
| ターミナルで開く | `open_in_terminal` | `open -a <アプリ> <パス>`。アプリ名は設定に持つ |
| プッシュ前のコミット一覧 | `get_push_preview` | `git log` で ahead 件数分を取る。スナップショットには載せない |
| UI 状態の保存 | `save_ui_state` | まとめて保存する (デバウンス)。**並び順もこれ 1 本で保存する** |

コピー系はフロントで `navigator.clipboard.writeText` を使う。IPC を通さない。  
失敗したらトーストで知らせる。黙って落とさない。

**`shell` プラグインの汎用実行は有効にしない。** `open` を叩く操作も専用コマンドとして持つ。

複数コマンドを続ける操作 (チェックアウトとプル) は、前が失敗したら止める。  
両方の出力をコンソールに残す。

### 強制プッシュで sha を明示する理由

値なしの `--force-with-lease` は、手元の追跡 ref を基準にする。  
このアプリは「すべてフェッチ」がワンクリックなので、**フェッチしてから強制プッシュを押すだけでリースが無意味になる。**

実測した手順。

1. 同僚が `origin/main` に push する
2. フェッチせずに強制プッシュ → `! [rejected] (stale info)` で正しく止まる
3. 「すべてフェッチ」を押す
4. もう一度強制プッシュ → 通ってしまい、同僚のコミットが消える

プッシュダイアログを開いた時点でユーザーが見ていた `origin/<名前>` の sha を渡す。  
その sha はコンソールにも残す。

### 他のローカルブランチのプルは早送り限定

`git fetch origin <名前>:<名前>` は**早送りできるときだけ成功する。**  
現在ブランチの `プル` (`git pull --rebase`) とは別物なので、UI の文言でも区別する。

失敗するのは次の 3 つ。

| 状況 | 出力 | 扱い |
| --- | --- | --- |
| ahead がある / 分岐している | `! [rejected] ... (non-fast-forward)` | 早送りできないと伝える。**プッシュの拒否と同じ文字列なので、操作の種別で判定を分ける** |
| どこかのワークツリーにチェックアウト済み | `refusing to fetch into branch` | そのワークツリーで `git -C <パス> pull --rebase` に切り替える |
| 追跡先が消えている (`gone`) | `couldn't find remote ref` | メニューのプルを無効にする |

### 重複の判定

リポジトリの同一性は `git rev-parse --git-common-dir` の実パスで判定する。

リンクされたワークツリーは独立したリポジトリとして登録できてしまうが、ref store をメインと共有している。  
別々に登録すると直列キューが別々になり、「すべてフェッチ」で同じ `refs/remotes/origin/*` を同時に更新して  
`unable to update local ref` で片方が落ちる (実測)。

- 追加時に `--git-common-dir` が既存と一致したら弾く
- 直列キューのキーもリポジトリ id ではなく `--git-common-dir` にする

## 失敗の扱い

終了コードが 0 以外なら失敗。  
自動で回復しない。stash も force も勝手にやらない。

よくある失敗には専用の文言を出す。  
それ以外は「失敗しました」+ コンソールへの導線にする。

| 状況 | git の出力 | 見せる文言 |
| --- | --- | --- |
| 未コミットがあってプル | `cannot pull with rebase` | プルに失敗しました (未コミットの変更あり) |
| リモートが進んでいて**プッシュ** | `! [rejected] ... (non-fast-forward)` | プッシュが拒否されました (リモートが先に進んでいます) |
| 手元が進んでいて**プル** (早送り不可) | `! [rejected] ... (non-fast-forward)` | 早送りできません (手元にコミットがあります) |
| リースが古くて強制プッシュ | `! [rejected] ... (stale info)` | リモートが更新されています。フェッチしてやり直してください |
| ワークツリーにチェックアウト済みでプル | `refusing to fetch into branch` | そのワークツリーで実行します (自動で切り替える) |
| 追跡先が消えていてプル | `couldn't find remote ref` | 追跡先が存在しません |
| detached HEAD でプル | `You are not currently on a branch` | ブランチ上にいません |
| ref のロック競合 | `unable to update local ref` | 同じリポジトリを二重に登録している可能性があります |
| 未コミットがあってチェックアウト | `Your local changes ... would be overwritten` | チェックアウトできません (変更が上書きされます) |
| コンフリクト | `CONFLICT` | 競合しました。手元で解決してください |
| 認証に失敗 | `Authentication failed` / `Permission denied` | 認証に失敗しました |
| ネットワーク | `Could not resolve host` | リモートに接続できませんでした |
| 別のワークツリーにチェックアウト済み | `already used by worktree at` | 別のワークツリーで使用中です (パスを添える) |

ツリーに `⧉` を出しているブランチのチェックアウトは、必ず `already used by worktree at` で失敗する。  
チェックアウトの項目を無効にするか、上の文言で失敗を見せるかのどちらかにする。黙って失敗させない。

**同じ文字列でも操作によって意味が逆になる。**  
`(non-fast-forward)` はプッシュなら「リモートが進んでいる」、プルなら「手元が進んでいる」。  
文字列だけで判定すると、プルしたのに「プッシュが拒否されました」と出る。  
判定は必ず「実行した操作の種別 × 出力」で行う。

失敗しても stdout / stderr は必ずコンソールに残す。  
文言を出したことで出力を捨てない。

## 実行後

書き込みのあとは、**成否に関係なく**対象リポジトリのスナップショットを取り直して表示を更新する。  
取り直しは書き込みと同じ直列区間の中で行う。  
楽観的更新はしない。詳細は [../adr/0009-concurrency-and-refresh.md](../adr/0009-concurrency-and-refresh.md)。

`git checkout X && git pull --rebase` のように 2 段の操作は、前半が成功して後半が失敗することがある。  
このとき取り直さないと、画面は元のブランチのまま・実態は X の rebase 中、という最悪のずれになる。

フェッチは全リポジトリに投げて、`repo_snapshot_updated` イベントで返ってきた順に差し替える。
