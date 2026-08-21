# アーキテクチャ

## 全体像

Tauri 2 の 2 プロセス構成。  
フロントは WebView 上の React、git を触るのは Rust 側だけ。

```
┌─ WebView (React + TypeScript) ──────────────┐
│  features/  画面の単位ごとの UI と状態       │
│  shared/    トークン・共通 UI・ユーティリティ │
│  ipc/       Tauri コマンドの薄いラッパと型    │
└──────────────┬──────────────────────────────┘
               │ invoke / event (JSON)
┌──────────────┴──────────────────────────────┐
│  commands/  Tauri コマンド (境界と入力検証)   │
│  git/       git CLI の実行とパース            │
│  store/     設定の永続化                      │
│  model/     フロントと共有する DTO            │
└─────────────────────────────────────────────┘
               │ std::process::Command
            ┌──┴──┐
            │ git │
            └─────┘
```

git はライブラリではなく CLI を叩く。  
理由は [adr/0002-git-cli.md](adr/0002-git-cli.md)。

## ディレクトリ

```
canopy/
├── src/                        フロントエンド
│   ├── app/                    エントリ、レイアウト、グローバルスタイル
│   ├── features/
│   │   ├── repo-tree/          ツリー本体、行、インジケーター、検索、並び替え
│   │   ├── detail/             右パネル
│   │   ├── console/            コンソールパネルとタブ
│   │   ├── sidebar/            左のアイコンツールバー
│   │   ├── context-menu/       右クリックメニュー
│   │   ├── dialog/             ダイアログの枠と個別ダイアログ
│   │   └── toast/              トースト
│   ├── shared/
│   │   ├── ui/                 features をまたいで使う部品
│   │   ├── hooks/
│   │   ├── lib/                純粋関数 (ツリー構築、フィルタなど)
│   │   └── styles/             トークン (CSS 変数) とリセット
│   ├── ipc/                    invoke のラッパ、DTO の型、イベント購読
│   └── store/                  Zustand のストア
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/           #[tauri::command] の定義
│   │   ├── git/                コマンド組み立て、実行、パース
│   │   ├── model/              serde の DTO
│   │   ├── store/              設定の読み書き
│   │   └── queue/              リポジトリごとの直列実行キュー
│   └── tests/                  統合テスト (実際の一時リポジトリを使う)
└── docs/
```

この構成は Feature-Sliced Design の考え方に沿っている。  
層 (`app` / `features` / `shared`) をまたぐ依存は一方向だけ許す。  
`shared` は `features` を知らない。`features` 同士は直接参照しない。

`features/` の中は「その画面でしか使わないもの」だけ置く。  
2 つ目の features から参照したくなった時点で `shared/` に上げる。

純粋なロジック (ツリー構築、絞り込み、並び替え) は `shared/lib/` に置いて、React に依存させない。  
テストが書きやすくなるので、判断に迷ったらロジックを外へ出す。

## データフロー

1. 起動時に `store` からリポジトリ一覧・並び順・UI 状態を読む
2. **リポジトリ見出しを全件すぐに描画する。** 中身は `loading` のまま
3. 各リポジトリの状態を Rust 側で並列に読み取り、`RepoSnapshot` として返す。届いた分から埋める
4. フロントはスナップショットを描画するだけ。git の状態をフロントで計算しない
5. 操作 (checkout / pull / push / fetch / rename) は Tauri コマンドを 1 回呼ぶ
6. コマンドは結果 (成否・stdout・stderr) を返し、**成否に関係なく**対象リポジトリのスナップショットを取り直して一緒に返す
7. フロントは結果からトーストとコンソール行を作り、スナップショットで表示を更新する。`revision` が古ければ捨てる

読み取りと書き込みを混ぜない。  
「操作 → 取り直し → 再描画」の一方向に統一して、楽観的更新はしない。  
git の実態と画面がずれる方が、少し待つより困る。

取り直しの具体的な規定は [specs/git-operations.md](specs/git-operations.md) と [adr/0009-concurrency-and-refresh.md](adr/0009-concurrency-and-refresh.md)。

## 並行性

- Tauri コマンドはすべて `async`。子プロセスは `tokio::process::Command`
- 同一リポジトリの git 操作は直列。`index.lock` の衝突を避ける
- スナップショットの取り直しも、その操作と同じ直列区間の中で行う
- 異なるリポジトリは並列。全体の同時実行数は semaphore で絞る
- 一括フェッチの同時実行上限は全体の上限より小さくして、対話操作の枠を空ける
- 一括フェッチの結果は `repo_snapshot_updated` イベントで返ってきた順に流す

詳細は [adr/0009-concurrency-and-refresh.md](adr/0009-concurrency-and-refresh.md)。

## エラーの扱い

- Rust 側は `Result` を返す。git の終了コードが 0 以外なら失敗として扱う
- 失敗しても stdout / stderr は必ずフロントに返す。コンソールに出すため
- 握りつぶさない。想定外のエラーも「不明なエラー」として必ず表面に出す
- 失敗をユーザーに見せる形は [specs/ui.md](specs/ui.md)

## 状態管理

| 状態 | 置き場所 |
| --- | --- |
| リポジトリの状態 | Zustand ストア。`Map<RepoId, RepoState>` で、リポジトリごとに loading / ready / error を持つ |
| 選択行・折りたたみ・検索語・パネルの開閉 | Zustand ストア (UI 状態) |
| 永続化するもの | Rust 側の store に書き戻す。項目は [specs/data-model.md](specs/data-model.md) の `UiState` |

折りたたみ状態のキーの形式は [specs/data-model.md](specs/data-model.md) にある。

## 表示のパフォーマンス

ツリーとコンソールを仮想スクロールにする。  
行の平坦化がその前提。折りたたみとグループ化はここで解決する。

```
flatten(repos, { expanded, query, groupDirectories, localOnly }) -> RowNode[]
```

**この形をフェーズ 1 で確定させる。**  
検索・グループ化・ローカルのみ表示はフェーズ 3 の機能だが、後から引数を足すと呼び出し側を全部直すことになる。  
`query` が空でないときは `expanded` を無視して展開する。永続化された折りたたみは書き換えない。

**ネイティブのスクロールバーは表示しない。** 自前のスクロールバーを描く。  
スクロール領域はそのビューポート要素になるので、仮想化にはそれを渡す。

ドラッグ並び替えは DOM のヒットテストではなくインデックスから位置を決める。  
方針は [adr/0004-virtual-scroll.md](adr/0004-virtual-scroll.md) と [adr/0012-scrollbar-and-virtualization.md](adr/0012-scrollbar-and-virtualization.md)。
