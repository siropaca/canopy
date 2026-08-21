#!/usr/bin/env python3
"""モックに差し込む架空データを生成する。

公開リポジトリに実データ (業務リポジトリの名前・ブランチ・コミットメッセージ) を
置かないため、モックの既定データはこれで作った架空のものにする。

実データで見たいときは `./build.sh --refresh-data` を使う。
そちらは data.local.js に書き出され、git 管理外になる。

使い方:
    python3 gen-sample-data.py > data.sample.js
"""
import json

ORG = "acme"
HOME = "/Users/dev/Projects/acme"

# 実データと同じ規模と状態の散らばりを再現する。
# ローカル 1〜4 本、リモート合計 300 本前後、タグは 2 リポジトリ、ワークツリーは 2 リポジトリ。
REPOS = [
    # (名前, リモート数, ローカルの定義, タグ, ワークツリー, 未コミット)
    ("acme-api", 76, [
        ("feature/rec-482-repeat-offer", dict(cur=1, ahead=2), "2 days ago"),
        ("develop", dict(behind=7), "5 days ago"),
        ("main", dict(behind=9), "6 days ago"),
        ("dev/rec-501-remove-feature-flag", dict(behind=6, wt=1), "30 hours ago"),
    ], [], [("dev/rec-501-remove-feature-flag", "rec-501-flag")], 6),
    ("acme-web", 55, [
        ("develop", dict(cur=1, behind=14), "6 days ago"),
        ("main", dict(behind=20), "6 days ago"),
        ("dev/rec-482-リピートオファー対応", dict(ahead=3, wt=1), "2 days ago"),
    ], [], [("dev/rec-482-リピートオファー対応", "rec-482")], 0),
    ("acme-admin", 39, [("develop", dict(cur=1), "3 months ago")], [], [], 1),
    ("acme-mobile", 58, [
        ("feature/push-notification", dict(cur=1), "2 weeks ago"),
        ("develop", {}, "2 weeks ago"),
    ], [], [], 1),
    ("acme-batch", 16, [
        ("develop", dict(cur=1), "8 days ago"),
        ("main", {}, "2 weeks ago"),
    ], [], [], 1),
    ("design-system", 2, [("main", dict(cur=1), "4 months ago")],
     ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.3", "v1.0.4", "v1.0.5", "v1.0.6", "v1.0.7"], [], 1),
    ("infra", 15, [
        ("develop", dict(cur=1), "10 days ago"),
        ("main", {}, "10 days ago"),
    ], [], [], 1),
    ("docs-site", 10, [
        ("develop", dict(cur=1), "13 days ago"),
        ("main", {}, "13 days ago"),
    ], [], [], 1),
    ("ml-pipeline", 12, [
        ("develop", dict(cur=1), "2 weeks ago"),
        ("main", {}, "2 weeks ago"),
    ], [], [], 0),
    ("landing", 3, [
        ("fix/ga4-blocked-by-csp", dict(cur=1, gone=1), "30 hours ago"),
        ("develop", dict(behind=3, ahead=1), "6 days ago"),
        ("main", dict(behind=4), "6 days ago"),
    ], [], [], 2),
    ("internal-tools", 14, [
        ("fix/rec-233-not-found", dict(cur=1, ahead=1), "2 days ago"),
        ("develop", {}, "10 days ago"),
        ("main", {}, "10 days ago"),
    ], ["preview"], [], 1),
]

PREFIXES = ["feature", "fix", "chore", "refactor", "docs", "test", "dependabot/npm_and_yarn"]
TOPICS = [
    "search-filter", "login-redirect", "csv-export", "rate-limit", "audit-log",
    "webhook-retry", "cache-warmup", "image-resize", "batch-timeout", "i18n-ja",
    "dark-mode", "table-sort", "csp-header", "session-kind", "trigger-build",
    "typecheck-ci", "e2e-flaky", "prisma-index", "otel-trace", "queue-worker",
]
SUBJECTS = [
    "feat: 検索フィルタに複数条件を追加",
    "fix: ログイン後のリダイレクト先が不正になる問題を修正",
    "refactor: レビュー指摘を反映しクエリ本数を整理",
    "perf: 一覧取得にインデックスを追加",
    "chore: trigger build",
    "docs: ADR を追記",
    "test: 早送りできないケースを追加",
    "fix: 未コミットがある状態のプルを弾く",
]
FILES = [
    ("M", "apps/api/src/offer/repeat.service.ts"),
    ("M", "apps/api/src/offer/repeat.controller.ts"),
    ("A", "apps/api/test/repeat.e2e-spec.ts"),
    ("D", "apps/api/src/offer/legacy-guard.ts"),
    ("M", "prisma/schema.prisma"),
    ("??", ".claude/"),
    ("M", "next.config.js"),
]


def remote_names(n, seed):
    """リモート追跡ブランチの名前を n 本ぶん作る。階層の深さも散らす。"""
    out = ["origin/develop", "origin/main"]
    i = 0
    while len(out) < n:
        p = PREFIXES[(seed + i) % len(PREFIXES)]
        t = TOPICS[(seed * 3 + i) % len(TOPICS)]
        name = f"origin/{p}/{t}"
        if p.startswith("dependabot"):
            name = f"origin/{p}/{t}-1.{i % 9}.0"
        if name not in out:
            out.append(name)
        i += 1
    return out[:n]


repos = []
for seed, (name, n_remote, locals_, tags, worktrees, dirty) in enumerate(REPOS):
    local = []
    for bname, flags, date in locals_:
        b = {"name": bname, "date": date}
        b.update({k: v for k, v in flags.items() if k != "wt"})
        b["log"] = [
            {"h": f"{(seed + 1) * 1111111 + i * 7:07x}"[:8],
             "s": SUBJECTS[(seed + i) % len(SUBJECTS)]}
            for i in range(5)
        ]
        local.append(b)

    files = [{"s": s, "p": p} for s, p in FILES[:dirty]]
    wt = []
    for branch, dirname in worktrees:
        wt.append({"b": branch, "p": f"/Users/dev/worktrees/{name}/{dirname}",
                   "dirty": 0, "files": []})

    repos.append({
        "n": name,
        "path": f"{HOME}/{name}",
        "url": f"https://github.com/{ORG}/{name}",
        "dirty": len(files),
        "files": files,
        "local": local,
        "remote": [{"name": r, "date": "3 weeks ago"} for r in remote_names(n_remote, seed)],
        "tags": [{"name": t, "date": "2 months ago"} for t in tags],
        "wt": wt,
    })

print("const D=" + json.dumps(repos, ensure_ascii=False, separators=(",", ":")) + ";")
