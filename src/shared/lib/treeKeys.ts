import type { RepoSnapshot } from "@/ipc/generated/RepoSnapshot";
import type { RepoId, RepoState, TreeScope } from "@/ipc/types";

/*
 * 折りたたみと選択の鍵。
 *
 * 形は `<リポジトリ id>|<スコープ>|<パス>` (docs/specs/data-model.md)。
 * **鍵にはリポジトリ名ではなく id を使う。** 同じディレクトリ名のリポジトリを
 * 2 つ登録すると、名前ベースでは折りたたみ状態が混ざる。
 *
 * 保存するのは**開いているキー**。閉じているキーではない。
 * 既定はリモートとタグが閉なので、閉じているキーを保存すると初期状態でも数百件になる。
 *
 * ブランチ名には `|` を入れられるので、鍵を `split("|")` で分解しない。
 * 判定は前方一致で行う。
 */

/** リポジトリ見出しの鍵 */
export function repoKey(repoId: RepoId): string {
  return `${repoId}|repo|`;
}

/** `ローカル` / `リモート` / `タグ` の括りの鍵 */
export function sectionKey(repoId: RepoId, scope: TreeScope): string {
  return `${repoId}|${scope}|`;
}

/** ディレクトリの鍵。`path` は括りからの相対 (`feature/rec-482`) */
export function directoryKey(repoId: RepoId, scope: TreeScope, path: string): string {
  return `${repoId}|${scope}|${path}`;
}

/**
 * 葉 (ブランチ・タグ) の鍵。選択にだけ使う。
 *
 * `leaf|` を挟むのは、同じ名前のディレクトリの鍵と衝突させないため。
 * 葉は折りたためないので、この鍵は保存しない。
 */
export function leafKey(repoId: RepoId, scope: TreeScope, name: string): string {
  return `${repoId}|${scope}|leaf|${name}`;
}

/**
 * 名前を変えたあとの、同じ行の鍵。
 *
 * 名前を変更したら新しい名前の行を選択したままにする (docs/specs/ui.md の
 * 「操作したあとの更新」)。**ブランチ名には `|` が入り得る**ので
 * `split("|")` で分解せず、`leaf|` までを前方一致で残す。
 */
export function renamedLeafKey(key: string, newName: string): string {
  const marker = "|leaf|";
  const at = key.indexOf(marker);
  return at < 0 ? key : `${key.slice(0, at + marker.length)}${newName}`;
}

/** `key` の配下の鍵か。自分自身は含まない */
export function isUnder(candidate: string, key: string): boolean {
  if (candidate === key) return false;
  if (key.endsWith("|repo|")) {
    // リポジトリを閉じたら、同じ id の全スコープを閉じる
    return candidate.startsWith(key.slice(0, -"repo|".length));
  }
  if (key.endsWith("|")) {
    // 括り。配下は同じスコープの全部
    return candidate.startsWith(key);
  }
  // ディレクトリ。配下はその下のパスだけ
  return candidate.startsWith(`${key}/`);
}

/** 開く。親は開けない (親は別に開く) */
export function open(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  next.add(key);
  return next;
}

/** 閉じる。**配下も全部閉じる** (docs/specs/ui.md の「ツリー」) */
export function close(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set<string>();
  for (const other of expanded) {
    if (other !== key && !isUnder(other, key)) next.add(other);
  }
  return next;
}

/** ディレクトリのパスを、名前の一覧から全部作る */
export function directoryPaths(names: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const name of names) {
    const segments = name.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join("/"));
    }
  }
  return [...paths];
}

/**
 * 登録した直後に開いておく鍵。
 *
 * リポジトリ見出しとローカルの括り、ローカルのディレクトリまで開く。
 * リモートとタグは閉じたまま (docs/specs/ui.md)。
 *
 * **開くのは登録したときの 1 回だけ。** 毎回これを当てると、
 * ユーザーが閉じた状態が起動のたびに戻ってしまう。
 */
export function defaultExpanded(repoId: RepoId, snapshot: RepoSnapshot): string[] {
  const names = snapshot.local.map((branch) => branch.name);
  return [
    repoKey(repoId),
    sectionKey(repoId, "local"),
    ...directoryPaths(names).map((path) => directoryKey(repoId, "local", path)),
  ];
}

/** 全部開く。ツリーに出る折りたためる鍵を集める */
export function allKeys(
  repoId: RepoId,
  snapshot: RepoSnapshot,
  scopes: readonly TreeScope[],
): string[] {
  const keys = [repoKey(repoId)];
  const items: Record<TreeScope, readonly string[]> = {
    local: snapshot.local.map((branch) => branch.name),
    remote: snapshot.remote.map((reference) => reference.name),
    tag: snapshot.tags.map((tag) => tag.name),
  };
  for (const scope of scopes) {
    const names = items[scope];
    if (names.length === 0) continue;
    keys.push(sectionKey(repoId, scope));
    keys.push(...directoryPaths(names).map((path) => directoryKey(repoId, scope, path)));
  }
  return keys;
}

/** 全リポジトリぶんの折りたためる鍵。「すべて展開」に使う */
export function allKeysOf(repos: readonly RepoState[], scopes: readonly TreeScope[]): string[] {
  const keys: string[] = [];
  for (const repo of repos) {
    if (repo.snapshot === null) {
      // 中身が分からないので見出しだけ開く
      keys.push(repoKey(repo.id));
      continue;
    }
    keys.push(...allKeys(repo.id, repo.snapshot, scopes));
  }
  return keys;
}
