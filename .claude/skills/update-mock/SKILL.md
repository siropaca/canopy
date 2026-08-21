---
name: update-mock
description: docs/mock の UI モックを更新する手順。tree.html を直接編集せず、テンプレートを編集して build.sh で再生成し、Chrome で表示を確認する。UI の仕様やデザインを変えるときに使う。
---

# モックの更新

`docs/mock/tree.html` は**生成物**。直接編集しない。

## 構成

| ファイル | 役割 |
| --- | --- |
| `tree.tmpl.html` | 編集する対象。`/*__DATA__*/` にデータが差し込まれる |
| `data.js` | ローカルのリポジトリから作ったスナップショット |
| `gen-data.py` | data.js を作り直すスクリプト |
| `build.sh` | tree.html を生成する |
| `tree.html` | 生成物。ブラウザで開いて確認する |

## 手順

1. `tree.tmpl.html` を編集する
2. 再生成する

```sh
cd docs/mock
./build.sh                    # データは据え置きで再生成
./build.sh --refresh-data     # ローカルのリポジトリから data.js も作り直す
```

3. ブラウザで確認する。**目で見るまで直ったと言わない**

確認は claude-in-chrome を使う。  
`file://` は開けないので、ローカルサーバー経由にする。

```sh
cd docs/mock && python3 -m http.server 8787
# http://127.0.0.1:8787/tree.html を開く
```

確認が終わったらサーバーを止め、開いたタブを閉じる。

4. 仕様に関わる変更なら `docs/specs/ui.md` も直す。デザイントークンを変えたなら `docs/design-system.md` も直す

## 注意

- モック内のデータは実在するリポジトリのスナップショット。ブランチ名やパスがそのまま入っている
- `MOCK_AHEAD` と `MOCK_FILES` は実データに存在しない状態を見るための作り物。実装には持ち込まない
- モックで踏んだ実装上の罠は `docs/pitfalls.md` に追記する
