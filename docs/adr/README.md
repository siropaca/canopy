# ADR

設計判断とその理由を残す場所。  
形式は MADR (Markdown Any Decision Records) を簡略化したもの。

## 決まり

- ファイル名は `<4 桁の連番>-<英小文字のスラッグ>.md`
- 1 ファイル 1 判断。判断を混ぜない
- ステータスは `提案中` / `採用` / `破棄` / `置き換え済み (ADR-XXXX)`
- **一度採用した ADR は書き換えない。** 判断が変わったら新しい ADR を書いて、古い方を `置き換え済み` にする
- 実装より先に書く。「実装したから追記する」ではなく「決めたから書く」

## 一覧

| # | 判断 | ステータス |
| --- | --- | --- |
| [0001](0001-tauri-react.md) | Tauri + React で作る | 採用 |
| [0002](0002-git-cli.md) | git はライブラリではなく CLI を呼ぶ | 採用 |
| [0003](0003-state-and-styling.md) | 状態は Zustand、スタイルは CSS Modules + トークン | 採用 |
| [0004](0004-virtual-scroll.md) | 一覧は仮想スクロールにする | 採用 |
| [0005](0005-persistence.md) | 設定は JSON ファイルに保存する | 置き換え済み (0016) |
| [0006](0006-serial-queue-per-repo.md) | git の書き込みはリポジトリごとに直列化する | 置き換え済み (0009) |
| [0007](0007-v1-scope.md) | v1 のスコープ | 採用 |
| [0008](0008-no-keyboard-shortcuts.md) | v1 はキーボード操作を持たない | 採用 |
| [0009](0009-concurrency-and-refresh.md) | 並行モデルと状態の取り直し方 | 採用 |
| [0010](0010-virtualize-console-only.md) | 仮想スクロールはコンソールだけにする | 破棄 |
| [0011](0011-residency.md) | 常駐と前面化 | 採用 |
| [0012](0012-scrollbar-and-virtualization.md) | スクロールバーを自前で描く。仮想化との両立 | 採用 |
| [0013](0013-type-generation.md) | 型は Rust から生成する | 採用 |
| [0014](0014-macos-only.md) | 対応プラットフォームは macOS のみ | 採用 |
| [0015](0015-auxiliary-operations.md) | v1 に含める補助操作 (コピー / Finder / ターミナル / 復帰) | 採用 |
| [0016](0016-store-without-plugin.md) | 設定は store プラグインを使わず自分で読み書きする | 採用 |

新しい ADR を足したらこの表にも追記する。
