import { useState } from "react";

import type { Branch } from "@/ipc/generated/Branch";
import type { Commit } from "@/ipc/generated/Commit";
import type { PushPreview } from "@/ipc/generated/PushPreview";
import { classNames } from "@/shared/lib/classNames";
import { canForcePush } from "@/shared/lib/selection";

import { Dialog } from "./Dialog";
import styles from "./PushDialog.module.css";

/*
 * プッシュ。形は docs/specs/ui.md の「プッシュ」。
 *
 * - 強制プッシュをオンにするとプライマリボタンが `強制プッシュ` に変わり赤くなる
 * - **ahead が 0 のときはチェックボックス自体を無効にする。** そのまま実行すると
 *   リモートを巻き戻して、他人のコミットを消す (docs/pitfalls.md)
 * - ahead も behind もあるときは、失われる behind 側のコミット一覧を出す
 * - 渡す sha は**この画面で見せていた** `origin/<名前>` のもの
 *   (docs/specs/git-operations.md の「強制プッシュで sha を明示する理由」)
 */

interface PushDialogProps {
  readonly repoName: string;
  readonly branch: Branch;
  /** `null` は読み込み中 */
  readonly preview: PushPreview | null;
  readonly onPush: (forceWithLease: string | null) => void;
  readonly onCancel: () => void;
}

export function PushDialog({ repoName, branch, preview, onPush, onCancel }: PushDialogProps) {
  const [force, setForce] = useState(false);
  // **リースに渡す sha が無いときは選ばせない。** 無いまま押すと、ボタンが
  // 「強制プッシュ」を出しながら通常プッシュが走る。
  // 読み込み中と、追跡先が消えていて比べる相手がいないときが該当する
  const forceAllowed = preview?.remote_sha != null && canForcePush(branch);
  const forcing = force && forceAllowed;
  const remote = preview?.remote ?? "origin";
  // リモート側の名前は Rust が持っている。`upstream` から切り出さない
  const remoteBranch = preview?.remote_branch ?? branch.name;

  return (
    <Dialog
      title={`コミットを ${repoName} にプッシュ`}
      confirmLabel={forcing ? "強制プッシュ" : "プッシュ"}
      danger={forcing}
      confirmDisabled={preview === null}
      wide
      onConfirm={() => {
        onPush(forcing ? (preview?.remote_sha ?? null) : null);
      }}
      onCancel={onCancel}
    >
      <div className={styles.route}>
        <b title={branch.name}>{branch.name}</b>
        <span className={styles.to}>→</span>
        <span className={styles.remote}>{remote}</span>
        <span className={styles.to}>:</span>
        <b title={remoteBranch}>{remoteBranch}</b>
      </div>

      <div className={styles.info}>{summary(branch, preview)}</div>
      {preview !== null && preview.ahead.length > 0 && <CommitList commits={preview.ahead} />}

      {forcing && preview !== null && preview.behind.length > 0 && (
        <>
          <div className={styles.warning}>
            この {preview.behind.length} 件のコミットがリモートから失われます
          </div>
          <CommitList commits={preview.behind} lost />
        </>
      )}

      <div className={classNames(styles.checkbox, !forceAllowed && styles.disabled)}>
        <input
          id="push-force"
          type="checkbox"
          checked={forcing}
          disabled={!forceAllowed}
          onChange={(event) => {
            setForce(event.target.checked);
          }}
        />
        <label htmlFor="push-force">強制プッシュ</label>
        <span className={styles.note}>--force-with-lease</span>
      </div>
    </Dialog>
  );
}

/**
 * 件数は**コミット一覧と同じ情報源から取る。**
 *
 * スナップショットの `ahead` とプレビューは別のタイミングで読むので、
 * 混ぜると「3 件をプッシュします」の下に 5 件並ぶ表示が出る。
 */
function summary(branch: Branch, preview: PushPreview | null): string {
  if (preview === null) return "読み込み中";
  // 追跡先が消えている (`gone`) ときも、リモート側には作り直しになる
  if (preview.upstream === null || branch.upstream_gone) {
    return "追跡ブランチが無いので新規に作成します";
  }
  if (preview.ahead.length === 0) return "プッシュするコミットはありません";
  return `${preview.ahead.length} 件のコミットをプッシュします`;
}

function CommitList({
  commits,
  lost = false,
}: {
  readonly commits: readonly Commit[];
  readonly lost?: boolean;
}) {
  return (
    <div className={styles.commits}>
      {commits.map((commit) => (
        <div className={styles.commit} key={commit.hash}>
          <span className={classNames(styles.dot, lost && styles.lostDot)} />
          <span className={styles.hash}>{commit.hash}</span>
          <span className={styles.subject} title={commit.subject}>
            {commit.subject}
          </span>
        </div>
      ))}
    </div>
  );
}
