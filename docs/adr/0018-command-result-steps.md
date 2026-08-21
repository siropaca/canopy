# ADR-0018: 操作の結果は「段」の列で返す

- ステータス: 採用
- 日付: 2026-08-21

## 背景

[ADR-0009](0009-concurrency-and-refresh.md) は操作コマンドの戻り値を `{ result, snapshot }` の 1 つにすると決めた。  
`result` の中身は [../specs/data-model.md](../specs/data-model.md) で `ok` / `command` / `stdout` / `stderr` / `message` の 5 項目にしていた。

これは「1 操作 = 1 コマンド」を前提にした形だが、実際には 1 操作で git を 2 回叩くものがある。

| 操作 | 実行する git |
| --- | --- |
| チェックアウトとプル | `git switch` → `git pull --rebase` |
| ブランチ名の変更 | `git branch -m` → `git branch --unset-upstream` |

[../specs/git-operations.md](../specs/git-operations.md) は「両方の出力をコンソールに残す」と決めているので、1 コマンド分しか入らない形では足りない。

## 決定

`CommandResult` を「段の列」+「どう終わったかの判別子」にする。

```
CommandResult { kind: "ran" | "skipped" | "direct", ok, steps: CommandStep[], message? }
CommandStep   { command, code, stdout, stderr }
```

`{ result, snapshot }` という**外側の形は変えない。** ADR-0009 の「フロントが 2 回 invoke する形にしない」はそのまま守る。

判別子を持つのは、**段が 0 個になる理由が 1 つではない**ため。  
重複排除で省略した (`skipped`)、git を実行しない操作の成功と失敗 (`direct`)、参照名が弾かれた・ディレクトリが消えたといったアプリ側の異常 (`direct`) が全部段 0 になる。  
`steps.length === 0` で見分けると、失敗ではない省略と本物の失敗が同じ見え方になる。

## 理由

- コンソールは「コマンド行 + その出力」を 1 単位として出す ([../specs/ui.md](../specs/ui.md) の「コンソール」)。段が分かれていないと 2 本目の出力をどのコマンドに紐づけるか決められない
- `ok` を全段の論理積にすると、「前が失敗したら止める」の結果が 1 つの真偽値で表せる
- `command` を 1 つだけ持つ形に段を後付けすると、代表のコマンドと段の列が二重に存在して、どちらが正か決まらない
- 判別子があると、フェーズ 3 のトーストとコンソールが `match` するだけで済む。無いと `message` の文字列を見て分岐することになる

## 検討した他の案

| 案 | 採らなかった理由 |
| --- | --- |
| `{ results: CommandResult[], snapshot }` にする | 外側の形が ADR-0009 と食い違う。`message` をどの要素に持たせるかも決まらない |
| 判別子を持たず `steps.length === 0` で見分ける | 省略・コピーの成功・アプリ側の異常が全部 0 になるので区別できない。**この形で書き始めてフェーズ 2 のレビューで作り直した** |
| 2 段の操作を 2 コマンドに分けてフロントから 2 回呼ぶ | 前半が成功して後半が失敗したときに、取り直しが 2 回走って途中の状態が画面に出る |
| 出力を改行で連結して 1 つの文字列にする | どこからが 2 本目か分からない。色分けもできない |

## 影響

- [../specs/data-model.md](../specs/data-model.md) の `CommandResult` の表を差し替える。`CommandStep` を足す
- `message` は失敗の理由だけでなく「成功しても伝えるべきこと」も載せる。リモートブランチのチェックアウトが既存のローカルへの切り替えになった場合がこれ
- フェーズ 3 のコンソールは段ごとに 1 ブロックを描く。トーストは `kind` で出し分ける
- `ok` だけを見て色を決めない。`skipped` は `ok` が false だが失敗ではない
