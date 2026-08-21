import type { Branch } from "@/ipc/generated/Branch";
import type { Ref } from "@/ipc/generated/Ref";
import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoState, RowNode, TreeScope } from "@/ipc/types";

import { changesForBranch, worktreeName } from "./branchView";
import { directoryKey, leafKey, repoKey, sectionKey } from "./treeKeys";

/*
 * ツリーを平坦な行の配列にする。
 *
 * 仮想スクロールの前提。折りたたみとグループ化はここで解決して、
 * DOM の入れ子で階層を作らない (docs/adr/0004-virtual-scroll.md)。
 *
 * **シグネチャはフェーズ 1 で確定させる。** 検索・グループ化・ローカルのみ表示は
 * フェーズ 3 の機能だが、後から引数を足すと呼び出し側を全部直すことになる
 * (docs/architecture.md)。
 */

/**
 * インデントの上限。
 *
 * CSS 側は `[data-depth="0"]` から `[data-depth="12"]` までを持つ。
 * ブランチ名は何段でも深くできるので、これより深い行は同じ位置に出す。
 */
export const MAX_DEPTH = 12;

export interface FlattenOptions {
  /** **開いている**鍵。閉じている鍵ではない (docs/specs/data-model.md) */
  readonly expanded: ReadonlySet<string>;
  /** 検索語。空でなければ `expanded` を無視して全部開く */
  readonly query: string;
  readonly groupDirectories: boolean;
  readonly localOnly: boolean;
}

const SECTIONS: readonly { readonly scope: TreeScope; readonly label: string }[] = [
  { scope: "local", label: "ローカル" },
  { scope: "remote", label: "リモート" },
  { scope: "tag", label: "タグ" },
];

/** 名前の並びはロケール込みの辞書順。数字は数として比べる */
const collator = new Intl.Collator("ja", { numeric: true });

/** 括りの中身。ローカルは `Branch`、リモートとタグは `Ref` */
type Item = Branch | Ref;

interface Leaf<T> {
  readonly item: T;
  readonly label: string;
}

interface Node<T> {
  readonly directories: Map<string, Node<T>>;
  readonly leaves: Leaf<T>[];
}

export function flatten(repos: readonly RepoState[], options: FlattenOptions): RowNode[] {
  const query = options.query.trim().toLowerCase();
  const searching = query !== "";
  // 検索中は折りたたみを無視して全部開く。**保存した折りたたみは書き換えない**
  const isOpen = (key: string) => searching || options.expanded.has(key);
  const hits = (name: string) => !searching || name.toLowerCase().includes(query);
  const scopes = options.localOnly ? SECTIONS.slice(0, 1) : SECTIONS;

  const rows: RowNode[] = [];
  for (const repo of repos) {
    const key = repoKey(repo.id);
    const snapshot = repo.snapshot;
    rows.push({
      kind: "repo",
      key,
      depth: 0,
      repoId: repo.id,
      running: repo.running,
      repo,
      expanded: isOpen(key),
      // ヒットが無いリポジトリも見出しだけ残す。薄く表示する (docs/specs/ui.md)
      matched: !searching || (snapshot !== null && countHits(snapshot, scopes, hits) > 0),
    });
    if (snapshot === null || !isOpen(key)) continue;

    for (const section of scopes) {
      const items = itemsOf(snapshot, section.scope);
      // 中身が無い括りは出さない (タグが無ければタグの行も出ない)
      if (items.length === 0) continue;
      const tree = group(items, options.groupDirectories, hits);
      if (searching && leafCount(tree) === 0) continue;

      const key = sectionKey(repo.id, section.scope);
      rows.push({
        kind: "section",
        key,
        depth: 1,
        repoId: repo.id,
        running: repo.running,
        scope: section.scope,
        label: section.label,
        expanded: isOpen(key),
      });
      if (!isOpen(key)) continue;
      emit(rows, tree, {
        depth: 2,
        prefix: "",
        scope: section.scope,
        snapshot,
        running: repo.running,
        isOpen,
      });
    }
  }
  return rows;
}

interface EmitContext {
  readonly depth: number;
  readonly prefix: string;
  readonly scope: TreeScope;
  readonly snapshot: RepoSnapshot;
  readonly running: boolean;
  readonly isOpen: (key: string) => boolean;
}

/** ディレクトリを先に、葉を後に。どちらも名前で辞書順 (docs/specs/ui.md) */
function emit(rows: RowNode[], node: Node<Item>, context: EmitContext): void {
  const { depth, prefix, scope, snapshot, running, isOpen } = context;
  const repoId = snapshot.id;

  const directories = [...node.directories.entries()].sort(([left], [right]) =>
    collator.compare(left, right),
  );
  for (const [name, child] of directories) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const key = directoryKey(repoId, scope, path);
    rows.push({
      kind: "directory",
      key,
      depth: clampDepth(depth),
      repoId,
      running,
      scope,
      label: name,
      expanded: isOpen(key),
    });
    if (isOpen(key)) {
      emit(rows, child, { ...context, depth: depth + 1, prefix: path });
    }
  }

  const leaves = [...node.leaves].sort((left, right) => collator.compare(left.label, right.label));
  for (const leaf of leaves) {
    const key = leafKey(repoId, scope, leaf.item.name);
    if (isBranch(leaf.item)) {
      const branch = leaf.item;
      rows.push({
        kind: "branch",
        key,
        depth: clampDepth(depth),
        repoId,
        running,
        branch,
        label: leaf.label,
        dirtyCount: changesForBranch(snapshot, branch)?.total ?? 0,
        worktreeName: worktreeName(branch.worktree_path),
      });
      continue;
    }
    rows.push({
      kind: scope === "remote" ? "remote" : "tag",
      key,
      depth: clampDepth(depth),
      repoId,
      running,
      reference: leaf.item,
      label: leaf.label,
    });
  }
}

/** ローカルブランチか。`Ref` は追跡の情報を持たない */
function isBranch(item: Item): item is Branch {
  return "is_current" in item;
}

function clampDepth(depth: number): number {
  return Math.min(depth, MAX_DEPTH);
}

function itemsOf(snapshot: RepoSnapshot, scope: TreeScope): readonly Item[] {
  if (scope === "local") return snapshot.local;
  if (scope === "remote") return snapshot.remote;
  return snapshot.tags;
}

/** 名前を `/` で畳んで木にする。グループ化オフなら全部を葉にする */
function group<T extends { readonly name: string }>(
  items: readonly T[],
  groupDirectories: boolean,
  hits: (name: string) => boolean,
): Node<T> {
  const root: Node<T> = { directories: new Map(), leaves: [] };
  for (const item of items) {
    if (!hits(item.name)) continue;
    if (!groupDirectories) {
      // 完全な名前を 1 行で出す
      root.leaves.push({ item, label: item.name });
      continue;
    }
    const segments = item.name.split("/");
    let node: Node<T> = root;
    for (const segment of segments.slice(0, -1)) {
      let child = node.directories.get(segment);
      if (child === undefined) {
        child = { directories: new Map(), leaves: [] };
        node.directories.set(segment, child);
      }
      node = child;
    }
    node.leaves.push({ item, label: segments.at(-1) ?? item.name });
  }
  return root;
}

function leafCount<T>(node: Node<T>): number {
  let count = node.leaves.length;
  for (const child of node.directories.values()) {
    count += leafCount(child);
  }
  return count;
}

/** 検索がその リポジトリで何件当たるか。括りをまたいで数える */
function countHits(
  snapshot: RepoSnapshot,
  scopes: readonly { readonly scope: TreeScope }[],
  hits: (name: string) => boolean,
): number {
  let count = 0;
  for (const { scope } of scopes) {
    for (const item of itemsOf(snapshot, scope)) {
      if (hits(item.name)) count += 1;
    }
  }
  return count;
}
