import { useState } from "react";

import type { Branch } from "@/ipc/generated/Branch";

import { Dialog } from "./Dialog";
import styles from "./DeleteBranchDialog.module.css";

/*
 * ローカルブランチの削除。形は docs/specs/ui.md の「ブランチの削除」。
 *
 * **既定は `git branch -d`。** マージされていなければ git が拒否するので、
 * その失敗をそのまま見せる。強制は選んだときだけ
 * (docs/adr/0021-delete-local-branch.md)。
 *
 * 「マージ済みか」をここで判定して出し分けない。判定と実行の間に状態が変わる。
 */

interface DeleteBranchDialogProps {
  readonly repoName: string;
  readonly branch: Branch;
  readonly onDelete: (force: boolean) => void;
  readonly onCancel: () => void;
}

export function DeleteBranchDialog({
  repoName,
  branch,
  onDelete,
  onCancel,
}: DeleteBranchDialogProps) {
  const [force, setForce] = useState(false);

  return (
    <Dialog
      title={`ブランチ ${branch.name} を削除`}
      confirmLabel={force ? "強制削除" : "削除"}
      danger={force}
      onConfirm={() => {
        onDelete(force);
      }}
      onCancel={onCancel}
    >
      <div className={styles.info}>
        {repoName} の {upstreamNote(branch)}
      </div>
      {force && (
        <div className={styles.warning}>
          マージしていないコミットも一緒に消えます。元に戻せません
        </div>
      )}

      <div className={styles.checkbox}>
        <input
          id="delete-force"
          type="checkbox"
          checked={force}
          onChange={(event) => {
            setForce(event.target.checked);
          }}
        />
        <label htmlFor="delete-force">マージされていなくても削除</label>
        {/* コンソールに残る行と字面を合わせる。`-D` は `--delete --force` */}
        <span className={styles.note}>-D</span>
      </div>
    </Dialog>
  );
}

/**
 * 追跡先の状態。**スナップショットで分かることだけ出す。**
 *
 * マージ済みかどうかはここでは分からない。押して git に聞く。
 */
function upstreamNote(branch: Branch): string {
  if (branch.upstream === null) return "ローカルだけのブランチです";
  if (branch.upstream_gone) return `追跡先の ${branch.upstream} は削除済みです`;
  if (branch.ahead > 0) {
    return `${branch.upstream} より ${branch.ahead} コミット進んでいます`;
  }
  return `${branch.upstream} を追跡しています`;
}
