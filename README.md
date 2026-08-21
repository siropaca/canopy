# Canopy

複数の git リポジトリのブランチを 1 つのツリーで俯瞰して、切り替え・取り込み・送信を行う macOS 向けの軽量デスクトップアプリ。

リポジトリを 10 個前後行き来する使い方で、**どのリポジトリに取り込む変更があるかを操作なしで把握する**ことを目的にしている。

> [!NOTE]
> 実装中です。いまは土台 (ビルド・検査・空のウィンドウ) までで、画面の中身はまだありません。  
> 仕様とデザインは動く UI モックにあります。進め方は [docs/plans/](docs/plans/)。

## できること (v1)

- **複数リポジトリを 1 画面で** — リポジトリごとのブランチツリーを縦に並べて、全体を一望する
- **ブランチ中心** — ローカル / リモート / タグをツリーで。スラッシュはディレクトリに畳む
- **状態が一目で分かる** — 取り込み待ち / 送信待ち / 未コミット / ワークツリー / 追跡ブランチの消失
- **操作** — チェックアウト、フェッチ、プル、プッシュ (強制プッシュを含む)、ブランチ名の変更
- **横断検索** — 全リポジトリのブランチとタグをまとめて絞り込む
- **コンソール** — 実行した git コマンドと出力をそのまま見られる。失敗の原因を追える

ログ・差分・コミット・リベース・マージ・ブランチの作成と削除は v2 以降。  
線引きの理由は [docs/adr/0007-v1-scope.md](docs/adr/0007-v1-scope.md)。

## UI

動く UI モックがあります。ブラウザで直接開けます。

```sh
open docs/mock/tree.html
```

これが仕様とデザインの参照元です。  
含まれているデータは架空のものです ([docs/mock/](docs/mock/))。

## 動作環境

- macOS 12 以降
- git 2.24 以降 (`git switch` と `--end-of-options` を使う)

外部への通信はしません。git を実行するだけです。  
リポジトリの情報がローカルの外に出ることはありません。

## ビルドと実行

```sh
mise install     # Node・pnpm・Rust
pnpm install
pnpm tauri dev   # 開発時
pnpm tauri build # ビルド
```

コマンドの一覧と検査の流れは [docs/development.md](docs/development.md)。

## 設計

| ドキュメント | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 実装するときの約束。テスト駆動、レビュー、ADR の運用 |
| [docs/motivation.md](docs/motivation.md) | 何を解決するために作っているか |
| [docs/architecture.md](docs/architecture.md) | プロセス構成、レイヤ、データフロー、並行性 |
| [docs/specs/](docs/specs/) | UI・git 操作・データモデルの仕様 |
| [docs/adr/](docs/adr/) | 設計判断とその理由 |
| [docs/plans/](docs/plans/) | フェーズごとの実装プラン |

技術的な選択の要点。

- **Tauri + React** — 常駐させたいので、メモリとバイナリの小ささを優先した ([ADR-0001](docs/adr/0001-tauri-react.md))
- **git は CLI を呼ぶ** — 認証と `.gitconfig` がそのまま効く。出力をコンソールにそのまま出せる ([ADR-0002](docs/adr/0002-git-cli.md))
- **書き込みはリポジトリごとに直列化** — `index.lock` の競合を避ける ([ADR-0009](docs/adr/0009-concurrency-and-refresh.md))
- **楽観的更新をしない** — 操作のあとは git から取り直す。画面と実態がずれる方が困る

## ライセンス

[MIT](LICENSE)
