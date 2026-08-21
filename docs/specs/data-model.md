# データモデル

Rust 側で組み立ててフロントに渡す。  
フロントはこの形をそのまま描画する。  
git の状態をフロントで再計算しない。

型は Rust の struct を単一の情報源にして、TypeScript 側は生成する ([../adr/0013-type-generation.md](../adr/0013-type-generation.md))。

この表を読むときの約束。

- `?` は「`null` が入り得る」と読む。`undefined` ではない
- `timestamp` は Unix ミリ秒の数値。相対時刻の文字列はフロントで組み立てる

## RepoState

フロントが持つリポジトリ 1 件分の状態。  
11 リポジトリを並列に読むので、**取得できた状態しか表現できない形にしない。**

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `id` | `string` | |
| `name` | `string` | 登録情報から来る。スナップショットが無くても表示できる |
| `path` | `string` | 同じく登録情報から来る絶対パス。表示とコピーのため |
| `status` | `"loading" \| "ready" \| "error"` | |
| `snapshot` | `RepoSnapshot?` | `ready` のときだけ |
| `error` | `string?` | `error` のときだけ。ディレクトリが消えている、git リポジトリではない、など |
| `running` | `bool` | このリポジトリに実行中の操作があるか。操作系 UI の有効条件になる |

`running` は**本数で数えて**真偽値に落とす。  
一括フェッチとユーザーの操作が重なったとき、真偽値だけで持つと先に終わった方が実行中の表示を消してしまう。

ストアは `Map<RepoId, RepoState>` にする。  
ツリーはリポジトリ見出しを最初から全件出して、中身だけ後から埋める。  
1 つの取得失敗で全体を落とさない。エラーのリポジトリは見出しに理由を出す。

## RepoSnapshot

リポジトリ 1 つ分の状態。

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `id` | `string` | アプリ内の識別子。パスをフロントに渡さないための鍵 |
| `name` | `string` | 表示名。ディレクトリ名 |
| `path` | `string` | 絶対パス。表示とコピーのために渡す |
| `origin_url` | `string?` | `origin` の URL を https 形式に正規化したもの |
| `local` | `Branch[]` | ローカルブランチ |
| `remote` | `Ref[]` | リモート追跡ブランチ。`origin/develop` のような短縮名 |
| `tags` | `Ref[]` | タグ |
| `worktrees` | `Worktree[]` | メイン以外のワークツリー |
| `changes` | `ChangeList` | メインのワークツリーの未コミット変更 |
| `fetched_at` | `timestamp?` | 最後に fetch が成功した時刻 |
| `revision` | `number` | このリポジトリのスナップショットの世代。単調増加。古いものを捨てるために使う |
| `head` | `Head` | HEAD の状態。ブランチか detached か |

## Branch

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `name` | `string` | `feature/rec-482` のような完全な名前 |
| `is_current` | `bool` | メインのワークツリーの HEAD か |
| `behind` | `number` | 追跡ブランチから取り込むコミット数 |
| `ahead` | `number` | 追跡ブランチへ出すコミット数 |
| `upstream` | `string?` | 追跡ブランチの名前。**未設定なら null**。`origin/<ブランチ名>` と決め打ちしない |
| `upstream_gone` | `bool` | 追跡先が設定されているが消えているか |
| `committed_at` | `timestamp` | 最終コミット日時。表示は相対時刻にする |
| `worktree_path` | `string?` | このブランチが別のワークツリーにチェックアウトされているなら、そのパス |

`behind` と `ahead` は 0 を「表示しない」意味として扱う。  
`null` と 0 を区別しない。

直近のコミット一覧は `Branch` に持たせない。  
プッシュダイアログを開いたときに `get_push_preview(repo_id, branch)` で取る。  
スナップショットに含めると、取り直すたびに全ローカルブランチ分の `git log` が走る。

**`upstream` が null (未設定) と `upstream_gone` (設定済みだが消えた) は別の状態。**  
プッシュのコマンドが変わる。未設定なら `-u` を付けて作る、消えているなら通常のプッシュ。  
同じフラグで扱うと、どちらかで間違ったコマンドを撃つ。

## Head

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `kind` | `"branch" \| "detached"` | |
| `name` | `string` | ブランチ名、または detached のときの参照 (タグ名や短縮ハッシュ) |

タグのチェックアウトは v1 に入っているので、**detached HEAD は必ず起きる。**  
このとき `Branch.is_current` は全ブランチ false になる。  
表示の扱いは [ui.md](ui.md) を参照。

## Ref

| フィールド | 型 |
| --- | --- |
| `name` | `string` |
| `committed_at` | `timestamp` |

## Worktree

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `branch` | `string` | チェックアウトされているブランチ |
| `path` | `string` | ワークツリーのパス |
| `changes` | `ChangeList` | **そのワークツリーの**未コミット変更 |

未コミットはワークツリー単位で持つ。  
リポジトリ単位にまとめると、ワークツリーで作業中の変更が別のブランチの表示に混ざる。

**載せるのはブランチが紐づくワークツリーだけ。**  
落とす条件は [git-operations.md](git-operations.md) の「読み取り」にある。  
「メイン」はアプリに登録したパスを指す。`worktree list` の先頭ではなく、登録したパスと一致するものを除いて並べる。

## ChangeList

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `items` | `Change[]` | 先頭 21 件まで |
| `total` | `number` | 全体の件数 |

**全件を IPC に載せない。**  
`.gitignore` を整える前のリポジトリでは `git status --porcelain` が数千行返る。  
UI は 20 件しか出さないので、Rust 側で 21 件に切って総数を別に渡す。  
`未コミットの変更 (n)` の n は `total` を使う。

**未追跡のディレクトリは git が 1 件に畳む。**  
`docs/` の下に 3 ファイル増えても `?? docs/` の 1 件として返る。  
`-uall` で開くと `.gitignore` を整える前のリポジトリで数千行になるので、git の既定のまま扱う。  
つまり `total` は「変更エントリの数」で、厳密なファイル数ではない。

## Change

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `status` | `string` | `M` / `A` / `D` / `R` / `??` |
| `path` | `string` | リポジトリルートからの相対パス |

## Commit

| フィールド | 型 |
| --- | --- |
| `hash` | `string` (短縮) |
| `subject` | `string` |

## コマンドの返し方

git の非ゼロ終了は**失敗ではなく結果**として返す。  
`Err` はアプリ側の異常 (プロセスの起動失敗、パスが消えている) だけに使う。

操作コマンドの戻り値は 1 つにまとめる。

```
{ result: CommandResult, snapshot: RepoSnapshot }
```

フロントが「操作」と「取り直し」で 2 回 invoke する形にしない。  
2 回に分けると、その間に別の更新が割り込んで一方向のフローが崩れる。

## CommandResult

操作の結果。

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `kind` | `"ran" \| "skipped" \| "direct"` | どう終わったか。**見せ方はこれで決める** |
| `ok` | `bool` | 求めたことができたか。`skipped` のときは何も起きていないので false |
| `steps` | `CommandStep[]` | 実行した git を順に。`ran` 以外は空 |
| `message` | `string?` | 人へ見せる 1 行。失敗の理由、または成功しても伝えるべきこと |

**1 操作で git を 2 回叩くものがある。**  
チェックアウトとプルは `git switch` → `git pull --rebase`、名前の変更は `git branch -m` → `git branch --unset-upstream`。  
両方の出力をコンソールに残すので、段の列で持つ ([../adr/0018-command-result-steps.md](../adr/0018-command-result-steps.md))。

`kind` の意味。

| 値 | いつ | 見せ方 |
| --- | --- | --- |
| `ran` | git を実行した | `ok` で成功と失敗を分ける。段をコンソールに出す |
| `skipped` | 同種操作が走っていたので実行しなかった | **失敗ではない。** 赤で出さない |
| `direct` | git を実行しない操作 (コピー、Finder、ターミナル)、およびアプリ側の異常 | `ok` で分ける。コンソールに出す段は無い |

**`steps` が空かどうかで見分けない。** 空になるのは `skipped` と `direct` の両方で、  
`direct` にはコピーの成功もアプリ側の異常も乗る。段の数では区別できない。

## CommandStep

git を 1 回実行した記録。コンソールの 1 ブロックに対応する。

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `command` | `string` | 実行したコマンド。ユーザーが打つ形 |
| `code` | `number?` | 終了コード。シグナルで死んだときと打ち切ったときは `null` |
| `stdout` | `string` | |
| `stderr` | `string` | |

**認証情報は Rust 側でマスクしてから載せる。**  
`https://x-access-token:TOKEN@github.com/...` という構成があり得る ([../security.md](../security.md))。

## PushPreview

プッシュダイアログに出すもの。`get_push_preview(repo_id, branch)` で取る。

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `branch` | `string` | |
| `remote` | `string` | プッシュ先のリモート名。追跡先が無ければ `origin` |
| `upstream` | `string?` | `origin/main` の形。未設定なら `null` |
| `remote_sha` | `string?` | **ダイアログを開いた時点の**追跡先の sha。強制プッシュのリースに渡す |
| `ahead` | `Commit[]` | 送るコミット |
| `behind` | `Commit[]` | 強制プッシュで失われるコミット。ahead と behind の両方があるときに見せる |

## RepoUpdate

一括フェッチの 1 件分。`repo_snapshot_updated` イベントの中身。

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `repo_id` | `string` | |
| `outcome` | `OpOutcome?` | 取れた結果。状態が読めなかったときは `null` |
| `error` | `string?` | `outcome` が `null` のときの理由 |

**読めなかったリポジトリも落とさずに知らせる。**  
落とすと「フェッチしたのに何も起きない」リポジトリができて、実行中の表示も解けない。

## UiState (永続化)

| フィールド | 意味 |
| --- | --- |
| `repo_order` | リポジトリの並び順 (id の配列) |
| `expanded` | **開いている**ノードのキー |
| `pane_width` | ツリーペインの幅 |
| `console_open` | コンソールの開閉 |
| `window` | ウィンドウの位置とサイズ。常駐するので復元する ([../adr/0011-residency.md](../adr/0011-residency.md)) |
| `group_directories` | ディレクトリのグループ化 |
| `local_only` | ローカルのみ表示 |

保存するのは「開いているキー」にする。折りたたんでいるキーではない。

既定はリモートとタグが閉なので、`collapsed` を保存する形にすると初期状態でも数百キーになる (実測でリモート 300 ref)。  
`fetch --prune` で消えた ref のキーも永久に溜まる。  
開いているキーなら通常は数件で、存在しないキーは読み込み時に捨てればよい。

キーは `<リポジトリ id>|<スコープ>|<パス>` の形にする。  
スコープは `repo` / `local` / `remote` / `tag` の 4 つ。リポジトリ見出しの開閉は `<id>|repo|`。  
`repo` を閉じたときは、同じ id の全スコープを閉じる。

**鍵にはリポジトリ名ではなく `id` を使う。**  
同じディレクトリ名のリポジトリを 2 つ登録すると、名前ベースでは折りたたみ状態とコンソールのタブが混ざる。  
インデックスを使うと並び替えでずれる。

葉 (ブランチ・タグ) の鍵は `<id>|<スコープ>|leaf|<名前>` にする。  
選択にしか使わないので保存しない。`leaf|` を挟むのは、同じ名前のディレクトリの鍵と衝突させないため。

**ブランチ名には `|` を入れられる。** 鍵を `split("|")` で分解せず、前方一致で判定する。

`repo_order` などとは別に、設定ファイルには「ターミナルで開く」が起動するアプリ名も入る。  
既定は `Terminal` ([../adr/0015-auxiliary-operations.md](../adr/0015-auxiliary-operations.md))。  
v1 に設定画面は無いので、変えるときは設定ファイルを直接編集する。

`expanded` に入っていない鍵は閉じている。  
**既定で開くのは登録した瞬間だけ**で、リポジトリ見出し・`ローカル` の括り・ローカルのディレクトリを開く。  
毎回この既定を当てると、ユーザーが閉じた状態が起動のたびに戻ってしまう。

> モックは名前を鍵にしている。同名リポジトリを扱えないので、実装では id にする。
