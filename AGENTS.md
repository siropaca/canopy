# AGENTS.md

Canopy のリポジトリで作業するエージェント向けのルール。  
何を作るかは [README.md](README.md)、どう作るかはこのファイルと `docs/` にある。

## 最初に読む

1. このファイル
2. [docs/architecture.md](docs/architecture.md) — 構成とディレクトリ
3. 着手するフェーズの [docs/plans/](docs/plans/) のプラン

**既存実装を読み解く前に docs を読む。**  
docs に書いていないことがあれば、それは調査して docs に書き足す対象。

## 絶対に守ること

- **テスト駆動で書く。** 失敗するテストを書いてから実装する。詳細は [docs/testing.md](docs/testing.md)
- **フェーズの完了時にサブエージェントのレビューを通す。** 手順は [docs/workflow.md](docs/workflow.md)
- **設計判断は ADR に残す。** 実装より先に [docs/adr/](docs/adr/) に追記する
- **ドキュメントを直したら波及を確認する。** 1 箇所を直すと別の場所が古くなる。`python3 scripts/check-docs.py` を必ず実行する
- **UI はモックに従う。** 見るのは [docs/mock/tree.html](docs/mock/tree.html)、直すのは `tree.tmpl.html` (`tree.html` は生成物)。UI を変えるならモックも更新する
- **v1 のスコープ外を実装しない。** 境界は [docs/adr/0007-v1-scope.md](docs/adr/0007-v1-scope.md)
- **依存パッケージの追加は事前に確認を取る。** 追加したら ADR かプランに理由を残す
- **commit と push は明示的に指示されたときだけ行う。**

## 書き方

- 応答・レビュー・ドキュメントは日本語。コード内の識別子とコメントは英語
- **特定製品の名前を表に出さない。** README、リポジトリの説明、アプリの UI、コミットメッセージには書かない。設計の根拠として `docs/` に書くのは構わない
- Markdown は 1 文 1 行、行末に半角スペース 2 つでハードブレーク。英数と日本語の間は半角スペース
- エラーを握りつぶさない。空 catch と安易な fallback を書かない
- TypeScript で `any` を使わない

コミットとブランチの規約、命名規則は [docs/development.md](docs/development.md)。

## ドキュメントの地図

| ファイル | 何が書いてあるか |
| --- | --- |
| [README.md](README.md) | 何のためのツールか、v1 でできること、起動方法 |
| [docs/motivation.md](docs/motivation.md) | 何を解決するために作っているか。設計の前提になっている事情 |
| [docs/architecture.md](docs/architecture.md) | プロセス構成、レイヤ、ディレクトリ、データフロー、並行性 |
| [docs/design-system.md](docs/design-system.md) | 色・寸法・アイコン・密度のトークンと使い分け |
| [docs/development.md](docs/development.md) | 環境構築、コマンド、命名規約、依存の追加手順 |
| [docs/testing.md](docs/testing.md) | TDD の進め方、テストの層、フィクスチャの作り方 |
| [docs/workflow.md](docs/workflow.md) | フェーズの進め方とサブエージェントレビューの手順 |
| [docs/specs/](docs/specs/) | UI・git 操作・データモデルの仕様 |
| [docs/adr/](docs/adr/) | 設計判断とその理由 |
| [docs/plans/](docs/plans/) | フェーズごとの実装プラン |
| [docs/security.md](docs/security.md) | IPC の境界、外部コマンド実行の安全策 |
| [docs/pitfalls.md](docs/pitfalls.md) | 実装で踏みやすい落とし穴。踏んだら追記する |
| [docs/mock/](docs/mock/) | 動く UI モック。仕様とデザインの参照元 |

同じことを 2 箇所に書かない。  
迷ったら上の表の担当に寄せて、他方からはリンクする。

分類は Diátaxis の 4 分類を目安にする。  
手順書 (development / testing / workflow)、仕様 (specs)、判断の記録 (adr)、説明 (architecture / design-system) を混ぜない。

## 指摘を受けたときの扱い

レビューやユーザーから指摘を受けたら、直すだけで終わらせない。

1. 同じ過ちが起きない場所に書く。ルールなら AGENTS.md、仕様なら `docs/specs/`、判断なら ADR
2. 仕組みで防げるなら仕組みにする。lint ルール、型、テスト、hook、skill の順で検討する
3. 3 回以上繰り返す手順が出てきたら skill 化する。既存の skill は `.claude/skills/` に置く

## この リポジトリ の仕組み

| 場所 | 何をしているか |
| --- | --- |
| `scripts/check-docs.py` | リンク切れ、ADR 一覧のずれ、死んだ ADR への参照、過去に間違えた表現の再発を検出する |
| `.claude/settings.json` | `git add -A` などの危険なコマンドを拒否。読み取り系コマンドは許可して確認を減らしている |
| `.claude/skills/phase-review/` | フェーズ完了時のレビュー手順 |
| `.claude/skills/update-mock/` | モックを再生成する手順 |
| `.claude/skills/new-adr/` | ADR を書く手順 |

仕組みで防げるようになったルールは、AGENTS.md の記述を削ってここに寄せる。  
人が覚えておく必要のあるルールだけを上に残す。
