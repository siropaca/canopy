import type { Branch } from "@/ipc/generated/Branch";
import type { ChangeList } from "@/ipc/generated/ChangeList";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { BranchRow, RefRow, RepoRow, RowNode } from "@/ipc/types";
import { useNow } from "@/shared/hooks/useNow";
import { changesForBranch, worktreeName } from "@/shared/lib/branchView";
import { FILE_LIMIT } from "@/shared/lib/changeList";
import { classNames } from "@/shared/lib/classNames";
import { formatRelativeTime } from "@/shared/lib/relativeTime";
import { shortenHome } from "@/shared/lib/shortenHome";
import { repoTotals } from "@/shared/lib/totals";
import { ScrollArea } from "@/shared/ui/ScrollArea";
import { AheadIcon, BehindIcon, BranchIcon, CurrentBranchIcon, TagIcon } from "@/shared/ui/icons";
import { useRepoStore } from "@/store/useRepoStore";

import styles from "./DetailPane.module.css";

/*
 * 右のペイン。選択したものの内容を出す。
 *
 * 出す項目は docs/specs/ui.md の「詳細ペイン」の表どおり。
 * **タグとリモートブランチに「追跡」と「差分」は出さない** (モックは出しているが誤り)。
 *
 * ボタンは置くが、フェーズ 1 で動くのは「リストから削除」だけ。
 * git を実行するものはフェーズ 2 で繋ぐ。
 */

interface DetailPaneProps {
  /** 画面に見えている選択行。見えていなければ null */
  readonly row: RowNode | null;
  readonly onRemoveRepo: (repoId: string) => void;
}

export function DetailPane({ row, onRemoveRepo }: DetailPaneProps) {
  const repo = useRepoStore((state) => (row === null ? undefined : state.byId.get(row.repoId)));
  const snapshot = repo?.snapshot ?? null;

  if (row === null || row.kind === "section" || row.kind === "directory") {
    return <Placeholder />;
  }
  if (snapshot === null) {
    // スナップショットが無くても、登録情報だけで見出しは描ける。
    // 壊れたリポジトリを一覧から外す導線をここで切らさない
    if (row.kind === "repo") {
      return (
        <div className={styles.pane}>
          <div className={styles.body}>
            <PendingRepositoryDetail row={row} onRemoveRepo={onRemoveRepo} />
          </div>
        </div>
      );
    }
    return <Placeholder />;
  }

  return (
    <ScrollArea className={styles.pane}>
      <div className={styles.body}>
        {row.kind === "repo" ? (
          <RepositoryDetail row={row} snapshot={snapshot} onRemoveRepo={onRemoveRepo} />
        ) : row.kind === "branch" ? (
          <BranchDetail row={row} snapshot={snapshot} />
        ) : (
          <ReferenceDetail row={row} snapshot={snapshot} />
        )}
      </div>
    </ScrollArea>
  );
}

function Placeholder() {
  return (
    <div className={styles.pane}>
      <div className={styles.placeholder}>ブランチを選択</div>
    </div>
  );
}

/**
 * まだ読めていないリポジトリ。
 *
 * `name` と `path` は登録情報から来るので、スナップショットが無くても出せる
 * (docs/specs/data-model.md の `RepoState`)。
 */
function PendingRepositoryDetail({
  row,
  onRemoveRepo,
}: {
  readonly row: RepoRow;
  readonly onRemoveRepo: (repoId: string) => void;
}) {
  const { repo } = row;
  return (
    <>
      <h1 className={styles.title}>{repo.name}</h1>
      <div className={styles.subtitle}>{shortenHome(repo.path)}</div>
      <dl className={styles.pairs}>
        <dt>状態</dt>
        <dd>
          {repo.status === "error" ? (
            <span className={styles.gone}>{repo.error}</span>
          ) : (
            "読み込み中"
          )}
        </dd>
      </dl>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.danger}
          onClick={() => {
            onRemoveRepo(row.repoId);
          }}
        >
          リストから削除
        </button>
      </div>
    </>
  );
}

interface RepositoryDetailProps {
  readonly row: RepoRow;
  readonly snapshot: RepoSnapshot;
  readonly onRemoveRepo: (repoId: string) => void;
}

function RepositoryDetail({ row, snapshot, onRemoveRepo }: RepositoryDetailProps) {
  const totals = repoTotals(snapshot);
  const current =
    snapshot.head.kind === "branch" ? snapshot.head.name : `detached (${snapshot.head.name})`;

  return (
    <>
      <h1 className={styles.title}>{snapshot.name}</h1>
      <div className={styles.subtitle}>{shortenHome(snapshot.path)}</div>
      <dl className={styles.pairs}>
        <dt>origin</dt>
        <dd>{snapshot.origin_url ?? <span className={styles.none}>なし</span>}</dd>
        <dt>ブランチ</dt>
        <dd>
          ローカル {totals.local} / リモート {totals.remote}
        </dd>
        <dt>現在</dt>
        <dd>{current}</dd>
        <dt>未コミット</dt>
        <dd>
          <DirtyCount total={totals.dirty} />
        </dd>
      </dl>
      <div className={styles.actions}>
        <button type="button" className={styles.primary}>
          フェッチ
        </button>
        <button type="button">プル</button>
        <button type="button">パスをコピー</button>
        <button
          type="button"
          className={styles.danger}
          onClick={() => {
            onRemoveRepo(row.repoId);
          }}
        >
          リストから削除
        </button>
      </div>
      <FileList changes={snapshot.changes} />
    </>
  );
}

function BranchDetail({
  row,
  snapshot,
}: {
  readonly row: BranchRow;
  readonly snapshot: RepoSnapshot;
}) {
  const now = useNow();
  const { branch } = row;
  const changes = changesForBranch(snapshot, branch);
  const worktree = snapshot.worktrees.find((entry) => entry.path === branch.worktree_path);

  return (
    <>
      <h1 className={styles.title}>
        {branch.is_current ? <CurrentBranchIcon /> : <BranchIcon />}
        {branch.name}
      </h1>
      <div className={styles.subtitle}>
        {snapshot.name}
        {branch.is_current ? " — 現在のブランチ" : ""}
      </div>
      <dl className={styles.pairs}>
        <dt>種別</dt>
        <dd>ローカル</dd>
        <dt>追跡</dt>
        <dd>
          <Upstream branch={branch} />
        </dd>
        <dt>差分</dt>
        <dd>
          <Difference behind={branch.behind} ahead={branch.ahead} />
        </dd>
        <dt>最終コミット</dt>
        <dd>{formatRelativeTime(branch.committed_at, now)}</dd>
        {worktree !== undefined && (
          <>
            <dt>ワークツリー</dt>
            <dd>
              {worktreeName(worktree.path)}{" "}
              <span className={styles.none}>{shortenHome(worktree.path)}</span>
            </dd>
          </>
        )}
        <dt>未コミット</dt>
        <dd>
          <DirtyCount total={changes?.total ?? 0} />
        </dd>
      </dl>
      <div className={styles.actions}>
        {branch.is_current ? (
          <>
            <button type="button" className={styles.primary}>
              プル
            </button>
            <button type="button">プッシュ</button>
          </>
        ) : (
          <>
            <button type="button" className={styles.primary}>
              チェックアウト
            </button>
            <button type="button">チェックアウトとプル</button>
            <button type="button">プッシュ</button>
          </>
        )}
        <button type="button">名前をコピー</button>
      </div>
      {changes !== null && <FileList changes={changes} />}
    </>
  );
}

/**
 * リモートブランチとタグ。
 *
 * **「追跡」と「差分」は出さない。** タグに追跡は無く、リモートブランチの
 * 差分はこの画面では持っていない (docs/specs/ui.md)。
 */
function ReferenceDetail({
  row,
  snapshot,
}: {
  readonly row: RefRow;
  readonly snapshot: RepoSnapshot;
}) {
  const now = useNow();
  const isTag = row.kind === "tag";
  return (
    <>
      <h1 className={styles.title}>
        {isTag ? <TagIcon /> : <BranchIcon />}
        {row.reference.name}
      </h1>
      <div className={styles.subtitle}>{snapshot.name}</div>
      <dl className={styles.pairs}>
        <dt>種別</dt>
        <dd>{isTag ? "タグ" : "リモート"}</dd>
        <dt>最終コミット</dt>
        <dd>{formatRelativeTime(row.reference.committed_at, now)}</dd>
      </dl>
      <div className={styles.actions}>
        <button type="button" className={styles.primary}>
          チェックアウト
        </button>
        <button type="button">{isTag ? "タグ名をコピー" : "名前をコピー"}</button>
      </div>
    </>
  );
}

function Upstream({ branch }: { readonly branch: Branch }) {
  if (branch.upstream === null) {
    return <span className={styles.none}>なし</span>;
  }
  if (branch.upstream_gone) {
    return <span className={styles.gone}>{branch.upstream} (削除済み)</span>;
  }
  return <>{branch.upstream}</>;
}

function Difference({ behind, ahead }: { readonly behind: number; readonly ahead: number }) {
  if (behind === 0 && ahead === 0) {
    return <span className={styles.none}>最新</span>;
  }
  return (
    <span className={styles.difference}>
      {behind > 0 && (
        <span className={styles.behind}>
          <BehindIcon />
          {behind}
        </span>
      )}
      {ahead > 0 && (
        <span className={styles.ahead}>
          <AheadIcon />
          {ahead}
        </span>
      )}
    </span>
  );
}

function DirtyCount({ total }: { readonly total: number }) {
  if (total === 0) return <span className={styles.none}>なし</span>;
  return <span className={styles.dirty}>{total} ファイル</span>;
}

function FileList({ changes }: { readonly changes: ChangeList }) {
  if (changes.total === 0) return null;
  const shown = changes.items.slice(0, FILE_LIMIT);
  const rest = changes.total - shown.length;

  return (
    <>
      <div className={styles.section}>未コミットの変更 ({changes.total})</div>
      <div className={styles.files}>
        {shown.map((change) => (
          <div className={styles.file} key={change.path}>
            <span className={classNames(styles.status, statusClass(change.status))}>
              {change.status}
            </span>
            <span className={styles.path} title={change.path}>
              {change.path}
            </span>
          </div>
        ))}
        {rest > 0 && <div className={classNames(styles.file, styles.more)}>他 {rest} 件</div>}
      </div>
    </>
  );
}

/** ステータス文字の色。`??` はグレー (docs/design-system.md) */
function statusClass(status: string): string | undefined {
  switch (status[0]) {
    case "M":
      return styles.modified;
    case "A":
      return styles.added;
    case "D":
      return styles.deleted;
    case "R":
      return styles.renamed;
    default:
      return styles.other;
  }
}
