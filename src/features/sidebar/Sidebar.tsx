import { classNames } from "@/shared/lib/classNames";

import * as icons from "./icons";
import styles from "./Sidebar.module.css";
import { Tooltip } from "./Tooltip";

/*
 * 左のアイコンツールバー。並びと有効条件は docs/specs/ui.md の「サイドバー」。
 *
 * フェッチは選択があればそのリポジトリ、無ければ全リポジトリ (docs/specs/ui.md)。
 * **一括フェッチの最中は無効。** 有効条件は `shared/lib/selection.ts` が決める。
 *
 * 「更新」は常に有効。状態を取り直すだけでネットワークを触らないので、
 * 実行中でも押せる (飛ばす判定は `store/refresh.ts`)。
 *
 * ツールチップは自前の吹き出し (Tooltip.tsx)。`title` は持たせない。
 * 持たせると OS のツールチップと二重に出る。
 */

interface SidebarProps {
  /** 「選択対象をプル」を有効にできるか (shared/lib/selection.ts) */
  readonly pullEnabled: boolean;
  /** 選択中のリポジトリに実行中の操作があると無効 */
  readonly fetchEnabled: boolean;
  /** 「リストから削除」を有効にできるか (shared/lib/selection.ts) */
  readonly removeEnabled: boolean;
  /** 「ブランチの削除」を有効にできるか (shared/lib/selection.ts) */
  readonly deleteEnabled: boolean;
  readonly groupDirectories: boolean;
  readonly localOnly: boolean;
  readonly consoleOpen: boolean;
  readonly onRefresh: () => void;
  readonly onFetch: () => void;
  readonly onPull: () => void;
  readonly onExpandLocal: () => void;
  readonly onExpandAll: () => void;
  readonly onCollapseAll: () => void;
  readonly onAddRepo: () => void;
  readonly onRemoveRepo: () => void;
  readonly onDeleteBranch: () => void;
  readonly onToggleGroup: () => void;
  readonly onToggleLocalOnly: () => void;
  readonly onToggleConsole: () => void;
}

export function Sidebar({
  pullEnabled,
  fetchEnabled,
  removeEnabled,
  deleteEnabled,
  groupDirectories,
  localOnly,
  consoleOpen,
  onRefresh,
  onFetch,
  onPull,
  onExpandLocal,
  onExpandAll,
  onCollapseAll,
  onAddRepo,
  onRemoveRepo,
  onDeleteBranch,
  onToggleGroup,
  onToggleLocalOnly,
  onToggleConsole,
}: SidebarProps) {
  return (
    <div className={styles.strip}>
      <Button label="新規ブランチ" v2>
        <icons.NewBranch />
      </Button>
      <Button label="ブランチの削除" disabled={!deleteEnabled} onClick={onDeleteBranch}>
        <icons.DeleteBranch />
      </Button>
      <Button label="更新" onClick={onRefresh}>
        <icons.Refresh />
      </Button>
      <Button label="フェッチ" disabled={!fetchEnabled} onClick={onFetch}>
        <icons.Fetch />
      </Button>
      <Button label="選択対象をプル" disabled={!pullEnabled} onClick={onPull}>
        <icons.Pull />
      </Button>

      <span className={styles.divider} />

      <Button label="すべて展開 (ローカルのみ)" onClick={onExpandLocal}>
        <icons.ExpandLocal />
      </Button>
      <Button label="すべて展開" onClick={onExpandAll}>
        <icons.ExpandAll />
      </Button>
      <Button label="すべて折りたたむ" onClick={onCollapseAll}>
        <icons.CollapseAll />
      </Button>
      <Button label="グループ化 ディレクトリ" active={groupDirectories} onClick={onToggleGroup}>
        <icons.Group />
      </Button>
      <Button label="ローカルのみ表示" active={localOnly} onClick={onToggleLocalOnly}>
        <icons.LocalOnly />
      </Button>

      <span className={styles.divider} />

      <Button label="リポジトリを追加" onClick={onAddRepo}>
        <icons.AddRepo />
      </Button>
      <Button label="リポジトリをリストから削除" disabled={!removeEnabled} onClick={onRemoveRepo}>
        <icons.RemoveRepo />
      </Button>

      <span className={styles.divider} />

      <Button label="コンソール" active={consoleOpen} onClick={onToggleConsole}>
        <icons.Console />
      </Button>
    </div>
  );
}

interface ButtonProps {
  readonly label: string;
  readonly children: React.ReactNode;
  /** v2 の機能。常に無効で、ツールチップに `(v2)` を付ける */
  readonly v2?: boolean;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}

function Button({ label, children, v2 = false, active = false, disabled, onClick }: ButtonProps) {
  const off = v2 || (disabled ?? false);
  const className = classNames(styles.button, active && styles.active, off && styles.off);
  // 見出しは 1 つ。ツールチップと読み上げの名前を分けない
  const name = v2 ? `${label} (v2)` : label;

  return (
    <Tooltip label={name}>
      <button
        type="button"
        className={className}
        aria-label={name}
        disabled={off}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
