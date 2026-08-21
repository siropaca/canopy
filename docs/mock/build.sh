#!/usr/bin/env bash
# モックを再生成する。
#
#   ./build.sh                 … 既定のデータで tree.html を作り直す
#   ./build.sh --refresh-data  … 手元のリポジトリから data.local.js を作り直して使う
#
# データの優先順位:
#   data.local.js があればそれを使う (git 管理外。実データが入る)
#   無ければ data.sample.js を使う (架空データ。これをコミットする)
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--refresh-data" ]]; then
  python3 gen-data.py "${2:-$HOME/Projects}" > data.local.js
  echo "data.local.js を更新した (実データ。コミットしない)"
fi

python3 - <<'PY'
import os
data_file = "data.local.js" if os.path.exists("data.local.js") else "data.sample.js"
tmpl = open("tree.tmpl.html").read()
data = open(data_file).read().strip()
assert "/*__DATA__*/" in tmpl, "テンプレートに /*__DATA__*/ が無い"
open("tree.html", "w").write(tmpl.replace("/*__DATA__*/", data))
print(f"tree.html を生成した (データ: {data_file})")
PY
