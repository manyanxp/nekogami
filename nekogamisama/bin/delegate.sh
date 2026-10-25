#!/usr/bin/env bash
# 猫神さまからサブオーケストレーターへ依頼を委任する。
#   使い方: bin/delegate.sh <名前> '<依頼文>'（作業場所が nekogamisama/ のとき。ルートからなら nekogamisama/bin/delegate.sh）
# suborchestrators.json に登録された名前だけが対象。依頼文は標準入力で渡す（引数として解釈させない）。
# 環境変数: CLAUDE_BIN（既定 claude）、DELEGATE_TIMEOUT（秒、既定 900）
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="${1:-}"
prompt="${2:-}"

if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]{0,63}$ || -z "$prompt" ]]; then
  echo "usage: delegate.sh <name> '<prompt>'" >&2
  exit 2
fi

dir="$(python3 -I - "$here" "$name" <<'PY'
import json, sys
from pathlib import Path
here, name = Path(sys.argv[1]), sys.argv[2]
reg = json.loads((here / 'suborchestrators.json').read_text(encoding='utf-8'))
if name not in reg:
    sys.exit(f"unknown sub-orchestrator: {name} (known: {', '.join(reg)})")
if reg[name].get('type', 'session') != 'session':
    sys.exit(f"{name} is type={reg[name]['type']}: call it with the Agent tool (subagent_type={reg[name].get('agent', name)}), not delegate.sh")
print((here / reg[name]['dir']).resolve())
PY
)"

cd "$dir"
printf '%s' "$prompt" | exec timeout "${DELEGATE_TIMEOUT:-900}" "${CLAUDE_BIN:-claude}" -p
