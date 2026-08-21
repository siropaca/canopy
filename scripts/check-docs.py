#!/usr/bin/env python3
"""ドキュメントの整合性を検査する。

レビューの指摘を反映したあと、他のファイルに波及していないかを機械的に確認するためのもの。
1 箇所を直すと別の場所が古くなる、という事故を防ぐ。

使い方:
    python3 scripts/check-docs.py

終了コード 0 で問題なし。1 で問題あり。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADR_DIR = os.path.join(ROOT, "docs/adr")
VALID_STATUS = ("提案中", "採用", "破棄", "置き換え済み")

# 過去に間違えた表現。直したはずのものが復活していないかを見る。
# 新しく間違えたら、そのたびにここへ足す。
BANNED = [
    ("already checked out at", "実際の git の出力は `already used by worktree at`"),
    ("パスをフロントから渡さない", "訂正済み。正しくは「git を実行する対象は id からのみ解決する」"),
    ("git checkout -- ", "参照名の前に `--` を置くと未コミットの変更が消える。`git switch` を使う"),
    ("作業ツリー", "「ワークツリー」に統一した (IDEA のメニュー文言だけ例外)"),
    ("git worktree list`", "`--porcelain` を付ける"),
    ("--force-with-lease origin", "sha を明示する。`--force-with-lease=<名前>:<sha>`"),
    ("--force origin", "`--force` は使わない。`--force-with-lease=<名前>:<sha>`"),
    ("check-ref-format <", "`--branch` を付ける。完全修飾名を要求されるので単一セグメントが弾かれる"),
    ("git checkout <名前>", "参照の切り替えは `git switch`。checkout はパスも受け取る"),
    ("git checkout <ブランチ>", "参照の切り替えは `git switch`。checkout はパスも受け取る"),
    ("git diff --exit-code", "生成物の検査は scripts/check-generated.sh の一時ディレクトリ比較に変えた"),
    ("std::process::Command", "子プロセスは `tokio::process::Command`"),
    ("列数の不一致を見ていない", "check_tables() が検出する"),
    ("CSP で無効になる書き方を書けなく", "React の style prop は CSSOM 経由なので CSP では止まらない"),
]
BANNED_EXCEPT = {
    "作業ツリー": ["docs/specs/ui.md"],          # IDEA のメニュー文言
    "already used by worktree at": [],
    "git checkout -- ": ["docs/pitfalls.md", "docs/security.md"],  # 罠として説明している箇所
    "already checked out at": ["scripts/check-docs.py"],
    "パスをフロントから渡さない": ["scripts/check-docs.py"],
    "git worktree list`": ["scripts/check-docs.py"],
    "--force-with-lease origin": ["scripts/check-docs.py"],
    "--force origin": ["scripts/check-docs.py"],
    # 罠として「こう書くな」を説明している箇所は除く
    "check-ref-format <": ["scripts/check-docs.py", "docs/security.md", "docs/pitfalls.md"],
    "git checkout <名前>": ["scripts/check-docs.py", "docs/pitfalls.md"],
    "git checkout <ブランチ>": ["scripts/check-docs.py"],
    "git diff --exit-code": ["scripts/check-docs.py"],
    # 「使わない」と書いてある箇所は除く
    "std::process::Command": ["scripts/check-docs.py", "docs/adr/0009-concurrency-and-refresh.md"],
    "列数の不一致を見ていない": ["scripts/check-docs.py"],
    "CSP で無効になる書き方を書けなく": ["scripts/check-docs.py"],
}

problems = []


def md_files():
    for base, dirs, files in os.walk(ROOT):
        if "/.git" in base or "/node_modules" in base or "/target" in base:
            continue
        for f in files:
            if f.endswith(".md"):
                yield os.path.join(base, f)


def rel(path):
    return os.path.relpath(path, ROOT)


def check_links():
    for path in md_files():
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            for m in re.finditer(r"\[[^\]]*\]\(([^)#]+)(#[^)]*)?\)", line):
                target = m.group(1)
                if target.startswith(("http://", "https://", "mailto:")):
                    continue
                full = os.path.normpath(os.path.join(os.path.dirname(path), target))
                if not os.path.exists(full):
                    problems.append(f"リンク切れ  {rel(path)}:{i} -> {target}")


def check_adr_index():
    index = os.path.join(ADR_DIR, "README.md")
    body = open(index, encoding="utf-8").read()
    files = sorted(
        f for f in os.listdir(ADR_DIR)
        if re.match(r"^\d{4}-", f) and f.endswith(".md")
    )
    for f in files:
        if f not in body:
            problems.append(f"ADR 一覧に無い  {f} を docs/adr/README.md に追記する")
    for f in files:
        head = "".join(open(os.path.join(ADR_DIR, f), encoding="utf-8").readlines()[:8])
        m = re.search(r"- ステータス:\s*(\S+)", head)
        if not m:
            problems.append(f"ステータスが無い  docs/adr/{f}")
        elif not m.group(1).startswith(VALID_STATUS):
            problems.append(f"ステータスが不正  docs/adr/{f} -> {m.group(1)}")


def check_superseded_refs():
    """置き換え済み / 破棄した ADR を、まだ根拠として指している箇所を見つける。"""
    dead = {}
    for f in os.listdir(ADR_DIR):
        if not re.match(r"^\d{4}-", f):
            continue
        head = "".join(open(os.path.join(ADR_DIR, f), encoding="utf-8").readlines()[:8])
        m = re.search(r"- ステータス:\s*(\S+)", head)
        if m and m.group(1).startswith(("置き換え済み", "破棄")):
            dead[f] = m.group(1)
    for path in md_files():
        name = os.path.basename(path)
        # ADR 同士の参照は履歴として正当 (置き換えた側が置き換えられた側を指す)
        if "/adr/" in path:
            continue
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            for f, status in dead.items():
                if f in line and name != f:
                    problems.append(
                        f"死んだ ADR を参照  {rel(path)}:{i} -> {f} ({status})"
                    )


def check_tables():
    """Markdown の表の列数がヘッダーと揃っているかを見る。

    レビュー反映で列を足して行を埋め忘れると、表そのものが崩れる。実際にやった。
    """
    for path in md_files():
        header = None
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            stripped = line.strip()
            if stripped.startswith("|"):
                # 区切り行 (|---|---|) をヘッダーの列数として覚える
                if set(stripped) <= set("|-: "):
                    header = stripped.count("|")
                    continue
                if header is None:
                    continue
                # セル内のエスケープしたパイプは数えない
                n = stripped.replace("\\|", "").count("|")
                if n != header:
                    problems.append(
                        f"表の列ずれ  {rel(path)}:{i} ヘッダー {header} 列 に対して {n} 列"
                    )
            else:
                header = None


# 表に出るファイル。ここに特定製品の名前を書かない (AGENTS.md の「書き方」)。
# 設計の根拠として docs/ に書くのは構わない
PUBLIC_FILES = ["README.md", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"]
PUBLIC_DIRS = ["src", "src-tauri"]
PRODUCT_WORDS = ["IntelliJ", "IDEA"]


def public_surface_files():
    for name in PUBLIC_FILES:
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            yield path
    for name in PUBLIC_DIRS:
        for base, dirs, files in os.walk(os.path.join(ROOT, name)):
            dirs[:] = [d for d in dirs if d not in ("target", "gen", "node_modules", "icons")]
            for f in files:
                if f.endswith((".ts", ".tsx", ".css", ".rs", ".html", ".json")):
                    yield os.path.join(base, f)


def check_public_surface():
    """アプリの表に出るところに特定製品の名前が入っていないかを見る。"""
    for path in public_surface_files():
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            for w in PRODUCT_WORDS:
                if w in line:
                    problems.append(
                        f"表に製品名  {rel(path)}:{i} 「{w}」 — 表に出るファイルには書かない"
                    )


def check_banned():
    for phrase, why in BANNED:
        allowed = BANNED_EXCEPT.get(phrase, [])
        for path in md_files():
            if rel(path) in allowed:
                continue
            for i, line in enumerate(open(path, encoding="utf-8"), 1):
                if phrase in line:
                    problems.append(f"古い表現  {rel(path)}:{i} 「{phrase}」 — {why}")


def main():
    check_links()
    check_adr_index()
    check_superseded_refs()
    check_tables()
    check_public_surface()
    check_banned()
    if problems:
        print(f"問題 {len(problems)} 件\n")
        for p in problems:
            print(" ", p)
        return 1
    print("問題なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
