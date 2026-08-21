#!/usr/bin/env python3
"""ローカルの git リポジトリからモック用のデータを生成する。

使い方:
    python3 gen-data.py [対象の親ディレクトリ] > data.js

data.js は tree.tmpl.html の /*__DATA__*/ に差し込まれる。
モックの表示内容を実物に合わせるためのもので、アプリの実装には使わない。
"""
import glob
import json
import os
import re
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Projects")


def git(cwd, *args):
    try:
        return subprocess.run(
            ("git",) + args, cwd=cwd, capture_output=True, text=True, timeout=25
        ).stdout.strip("\n")
    except Exception:
        return ""


def track(text, key):
    if key in text:
        found = [x for x in text.strip("[]").split(", ") if x.startswith(key)]
        if found:
            return int(found[0].split()[1])
    return None


def web_url(url):
    m = re.match(r"(?:git@([^:]+):|https://([^/]+)/)(.+?)(?:\.git)?$", url or "")
    return f"https://{m.group(1) or m.group(2)}/{m.group(3)}" if m else url


def status(path):
    return [
        {"s": line[:2].strip() or "?", "p": line[3:]}
        for line in git(path, "status", "--porcelain").splitlines()
        if line.strip()
    ]


def pairs(lines):
    for line in lines:
        parts = (line.split("\t") + [""])[:2]
        yield parts[0], parts[1]


repos = []
for d in sorted(glob.glob(os.path.join(ROOT, "*/"))):
    if not os.path.isdir(os.path.join(d, ".git")):
        continue
    path = d.rstrip("/")
    current = git(d, "branch", "--show-current")

    local = []
    fmt = "%(refname:short)\t%(upstream:track)\t%(committerdate:relative)"
    for line in git(d, "for-each-ref", "refs/heads", f"--format={fmt}").splitlines():
        name, t, date = (line.split("\t") + ["", ""])[:3]
        branch = {"name": name, "date": date}
        if name == current:
            branch["cur"] = 1
        if "gone" in t:
            branch["gone"] = 1
        for key in ("behind", "ahead"):
            v = track(t, key)
            if v:
                branch[key] = v
        branch["log"] = [
            {"h": h, "s": s}
            for h, s in pairs(git(d, "log", "-5", "--format=%h\t%s", name).splitlines())
            if h
        ]
        local.append(branch)

    remote = [
        {"name": n, "date": dt}
        for n, dt in pairs(
            git(d, "for-each-ref", "refs/remotes",
                "--format=%(refname:short)\t%(committerdate:relative)").splitlines()
        )
        if "/" in n and not n.endswith("/HEAD")
    ]
    tags = [
        {"name": n, "date": dt}
        for n, dt in pairs(
            git(d, "for-each-ref", "refs/tags",
                "--format=%(refname:short)\t%(committerdate:relative)").splitlines()
        )
        if n
    ]

    worktrees = []
    for line in git(d, "worktree", "list").splitlines():
        wt_path = line.split()[0]
        branch_name = line[line.find("[") + 1: line.rfind("]")] if "[" in line else ""
        if os.path.realpath(wt_path) == os.path.realpath(d):
            continue
        wt_files = status(wt_path)
        worktrees.append({"b": branch_name, "p": wt_path,
                          "dirty": len(wt_files), "files": wt_files})

    files = status(d)
    repos.append({
        "n": os.path.basename(path),
        "path": path,
        "url": web_url(git(d, "remote", "get-url", "origin")),
        "dirty": len(files),
        "files": files,
        "local": local,
        "remote": remote,
        "tags": tags,
        "wt": worktrees,
    })

print("const D=" + json.dumps(repos, ensure_ascii=False, separators=(",", ":")) + ";")
