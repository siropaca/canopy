import { useCallback, useMemo, useState } from "react";

import type { ConsoleLineKind, ConsoleOutputLine } from "@/shared/lib/consoleLog";
import { classNames } from "@/shared/lib/classNames";
import { consoleLines } from "@/shared/lib/consoleLog";
import { CONSOLE_LINE_HEIGHT } from "@/shared/styles/rowHeight";
import { ScrollArea } from "@/shared/ui/ScrollArea";
import { VirtualRows } from "@/shared/ui/VirtualRows";
import { consoleTabs, useConsoleStore } from "@/store/useConsoleStore";
import { useRepoStore } from "@/store/useRepoStore";
import { useUiStore } from "@/store/useUiStore";

import styles from "./ConsolePanel.module.css";

/*
 * コンソールパネル。
 *
 * リポジトリごとのタブを持ち、出力があった分だけ増える
 * (docs/specs/ui.md の「コンソール」)。**読み取り専用。** 入力は受けない。
 *
 * 出力は使うほど増え続けるので仮想スクロールにする
 * (docs/adr/0012-scrollbar-and-virtualization.md)。
 * 行は折り返すので高さは実測する (`measure`)。
 */

/**
 * 行の色。
 *
 * **種別からクラスを動的に引かない。** 参照を機械で追えなくなる
 * (`src/test/css-modules.test.ts` が落とす)。分岐は文字列リテラルで書く。
 */
const LINE_CLASS: Record<ConsoleLineKind, string | undefined> = {
  command: styles.command,
  output: styles.plain,
  error: styles.error,
};

export function ConsolePanel() {
  const open = useUiStore((state) => state.consoleOpen);
  const toggleConsole = useUiStore((state) => state.toggleConsole);
  const blocks = useConsoleStore((state) => state.blocks);
  const activeTab = useConsoleStore((state) => state.activeTab);
  const failed = useConsoleStore((state) => state.failed);
  const openTab = useConsoleStore((state) => state.openTab);
  const closeTab = useConsoleStore((state) => state.closeTab);
  const repos = useRepoStore((state) => state.byId);

  const tabs = useMemo(() => consoleTabs({ blocks }), [blocks]);
  const lines = useMemo(
    () => consoleLines(activeTab === null ? undefined : blocks.get(activeTab)),
    [blocks, activeTab],
  );

  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const onViewport = useCallback((element: HTMLElement | null) => {
    setViewport(element);
  }, []);

  if (!open) return null;

  return (
    <div className={styles.console}>
      <div className={styles.tabs}>
        {/* タブが無いときは左端に見出しを出す (docs/specs/ui.md) */}
        {tabs.length === 0 && <span className={styles.title}>コンソール</span>}
        {tabs.map((repoId) => (
          <Tab
            key={repoId}
            name={repos.get(repoId)?.name ?? repoId}
            active={repoId === activeTab}
            failed={failed.has(repoId)}
            onOpen={() => {
              openTab(repoId);
            }}
            onClose={() => {
              closeTab(repoId);
            }}
          />
        ))}
        <span className={styles.spacer} />
        <span className={styles.readOnly}>読み取り専用</span>
        <button
          type="button"
          className={styles.close}
          title="コンソールを閉じる"
          onClick={toggleConsole}
        >
          <CloseIcon />
        </button>
      </div>

      <div className={styles.body} title="このビューは読み取り専用です">
        {lines.length === 0 ? (
          <p className={styles.empty}>出力はまだありません</p>
        ) : (
          <ScrollArea className={styles.scroll} onViewport={onViewport}>
            <VirtualRows
              items={lines}
              rowHeight={CONSOLE_LINE_HEIGHT}
              scrollElement={viewport}
              keyOf={keyOf}
              renderRow={renderLine}
              measure
              // 末尾を追いかける。行の並びが変わったときだけ動く
              revealKey={lines.at(-1)?.key}
            />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

interface TabProps {
  readonly name: string;
  readonly active: boolean;
  readonly failed: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

function Tab({ name, active, failed, onOpen, onClose }: TabProps) {
  return (
    <span className={classNames(styles.tab, active && styles.tabActive)}>
      {/* 失敗の印。**そのタブを開くと消える** (docs/specs/ui.md) */}
      {failed && <span className={styles.dot} title="失敗した出力があります" />}
      <button type="button" className={styles.tabName} onClick={onOpen}>
        {name}
      </button>
      <button
        type="button"
        className={styles.tabClose}
        title={`${name} のタブを閉じる`}
        onClick={onClose}
      >
        ✕
      </button>
    </span>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function keyOf(line: ConsoleOutputLine): string {
  return line.key;
}

function renderLine(line: ConsoleOutputLine) {
  return <div className={LINE_CLASS[line.kind]}>{line.text}</div>;
}
