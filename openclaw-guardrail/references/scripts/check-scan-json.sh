#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: $0 <scan_json_file>"
  exit 1
fi

FILE="$1"

if [[ ! -f "$FILE" ]]; then
  echo "文件不存在: $FILE"
  exit 2
fi

python3 - <<'PY' "$FILE"
import json, sys

fp = sys.argv[1]
with open(fp, 'r', encoding='utf-8') as f:
    data = json.load(f)

required = [
    'schema_version', 'scan_id', 'timestamp', 'openclaw_version',
    'os', 'workspace', 'scan_type', 'summary', 'steps', 'findings'
]

missing = [k for k in required if k not in data]
if missing:
    print('❌ 缺少字段:', ', '.join(missing))
    sys.exit(3)

print('✅ scan json 字段完整')
PY
