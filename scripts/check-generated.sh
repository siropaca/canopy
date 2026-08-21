#!/bin/sh
# コミットされている TypeScript の型が、いまの Rust の struct から生成されるものと
# 一致するかを確認する。一時ディレクトリに生成して比べるので、
# 「手で直した生成物」と「struct を変えたのに生成し忘れ」の両方を検出できる。
# (docs/adr/0013-type-generation.md)
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out="$root/src/ipc/generated"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! log=$(TS_RS_EXPORT_DIR="$tmp" cargo test --manifest-path "$root/src-tauri/Cargo.toml" \
  --quiet export_bindings 2>&1); then
  printf '%s\n' "$log" >&2
  echo "型の生成に失敗した" >&2
  exit 1
fi

if ! diff -ru -x '.*' "$out" "$tmp"; then
  echo >&2
  echo "生成した型が最新ではない。pnpm gen:types を実行して差分をコミットする" >&2
  exit 1
fi
