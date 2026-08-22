import type { Toast } from "@/store/useToastStore";
import { classNames } from "@/shared/lib/classNames";
import { showConsoleFor } from "@/store/consoleActions";
import { useToastStore } from "@/store/useToastStore";

import styles from "./Toasts.module.css";

/*
 * トースト。右下に積む。
 *
 * 件数と表示時間はストアが持つ (`store/useToastStore.ts`)。
 * **一括操作は 1 件に集約してから届く** (`store/results.ts`)。
 * ここは出すだけ。
 */

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div className={styles.toasts}>
      {toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastLine({ toast }: { readonly toast: Toast }) {
  const failed = toast.kind === "failure";
  const { detailRepoId } = toast;

  return (
    <div className={classNames(styles.toast, failed && styles.failure)}>
      <span className={styles.icon}>{failed ? "!" : "i"}</span>
      <div className={styles.message}>
        {toast.repoName !== undefined && <span className={styles.repo}>{toast.repoName}</span>}{" "}
        {toast.command === true ? <code>{toast.text}</code> : toast.text}
        {/* **導線はコンソールに出す段があるときだけ** (docs/specs/ui.md) */}
        {detailRepoId !== undefined && (
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              showConsoleFor(detailRepoId);
            }}
          >
            詳細を見る
          </button>
        )}
      </div>
    </div>
  );
}
