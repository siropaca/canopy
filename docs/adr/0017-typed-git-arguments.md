# ADR-0017: git に渡す参照と sha は型で縛る

- ステータス: 採用
- 日付: 2026-08-21

## 背景

[../security.md](../security.md) は「**すべての参照引数**を共通の検証関数に通す」と決めている。  
根拠も書いてある。`checkout_branch(repo_id, "-f")` の 1 発で `git checkout -f` になり、ワークツリーの未コミット変更が全部消える。

フェーズ 2 で参照を受け取るコマンドが一気に増える。  
「関数を通す」だけの決まりでは、次の 1 本を足す人が通し忘れても何も起きない。  
`RepoPath` は同じ問題を型で解決している ([../plans/phase-1-read.md](../plans/phase-1-read.md) の「決めたこと」)。

強制プッシュの sha も同じ形の穴になる。  
`--force-with-lease=<リモート側のブランチ名>:<sha>` の sha は**フロントが画面で見せていた値をそのまま送ってくる**ので、16 進数以外が乗り得る。

## 決定

git に渡す引数を型に限る。**書き込みは生の `&str` を受け付けない。**

| 型 | 作り方 | 中身の検査 |
| --- | --- | --- |
| `RefName` | `RefName::branch(dir, name)` / `RefName::tag(dir, name)` | `-` 始まり・`@{`・`..`・空を拒否したうえで `git check-ref-format` |
| `ObjectName` | `ObjectName::parse(raw)` | 7〜64 桁の 16 進数だけ |
| `Composed` | 下の表の名前付きコンストラクタだけ | 組み立ての材料が上の型か、git 自身の出力 |
| `Arg` | `Fixed(&'static str)` / `Ref(&RefName)` / `Value(&Composed)` | 型そのものが検査 |

書き込みを実行する関数 (`git::write` の `one`) は `&[Arg]` を受ける。  
`Arg::Fixed` はコードに書いた固定文字列しか入らないので、**参照を渡すには検証を通った型を作るしかない。**

`Composed` はフィールドが private で、作れるのは次だけ。

| コンストラクタ | 作るもの |
| --- | --- |
| `Composed::from_git_output(値)` | git 自身の出力から来た値 (リモート名、追跡先) |
| `Composed::of_ref(&RefName)` | 検証を通った参照 |
| `Composed::tag_ref(&RefName)` | `refs/tags/<名前>` |
| `Composed::refspec(&Composed, &RefName)` | `<上流>:<ローカル>` (早送り) |
| `Composed::push_refspec(&RefName, &Composed)` | `<ローカル>:<上流>` (プッシュ) |
| `Composed::lease(&Composed, &ObjectName)` | `--force-with-lease=<リモート側のブランチ名>:<sha>` |
| `Composed::range(&Composed, &Composed)` | `<元>..<先>` |

**`Composed::from_git_output` は型では守れない入口。**  
呼んで良いのは git の出力をパースした直後だけで、これは
`RepoPath::from_picked_folder` と同じ扱い ([../security.md](../security.md))。  
ユーザーから来た文字列をここに通さない。

## 理由

- 検証を**忘れられない形**にできる。`RepoPath` と同じ手口で、レビューではなく型で守る
- `check-ref-format` は完全修飾名を要求するので、ブランチとタグで渡し方が違う。その差を型の中に閉じ込められる ([../pitfalls.md](../pitfalls.md))
- `--branch '@{-1}'` は `check-ref-format` を通ってしまう。前段の拒否と `check-ref-format` を必ずセットで通す場所が要る
- sha を別の型にすると、参照名の検査 (スラッシュを許す) を sha に流用する事故が起きない

## 検討した他の案

| 案 | 採らなかった理由 |
| --- | --- |
| 検証関数を呼ぶ決まりだけにする | 呼び忘れが検出できない。参照を受け取るコマンドが増える時点で破綻する |
| `RefName` / `ObjectName` だけ用意して、実行関数は `&[&str]` のまま | **フェーズ 2 のレビューで指摘されて作り直した形。** 型を用意しても、実行関数が `&str` を受けるなら未検証の名前を渡すコードが普通に書けて、コンパイルも lint も通る |
| 組み立てた値も `&str` で受ける | refspec や `--force-with-lease=...` の口から未検証の文字列が入る。`Composed` に閉じないと `Arg` の意味が無い |
| コマンドの入口 (`commands/ops.rs`) で検証する | 実行するのは `git::write` なので、入口を増やしたときに素通りする経路ができる |
| 正規表現だけで判定して git を起こさない | `check-ref-format` の規則は複雑 (末尾 `.lock`、連続スラッシュ、制御文字)。自前で持つと git と食い違う |
| sha も `RefName` で受ける | スラッシュを許す検査なので `refs/heads/main` が sha として通る |

## 影響

- 書き込みの操作を足すときは `Arg` を並べる。参照を渡すには `RefName` を作るしかなく、作らないとコンパイルが通らない
- 読み取り (`run` / `run_ok`) は `&[&str]` のまま。渡すのは固定文字列と、検証を通った型から取り出した値だけ。壊れても「違う ref を読む」で止まり、破壊はしない
- 検証のために git を 1 回起こす。書き込みのロックの中で走るので、読み取りとは競合しない
- `check-ref-format` は `--end-of-options` を受け付けない (parse-options を使っていない)。`-` 始まりを前段で拒否しているので問題にならない
