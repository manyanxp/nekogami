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

# 出力: 1 行目 = 実行するフォルダ、以降 = `E<TAB>キー<TAB>値`（環境変数）/ `A<TAB>引数`（claude への引数）
spec="$(python3 -I - "$here" "$name" <<'PY'
import json, sys
from pathlib import Path
here, name = Path(sys.argv[1]), sys.argv[2]
reg = json.loads((here / 'suborchestrators.json').read_text(encoding='utf-8'))
if name not in reg:
    sys.exit(f"unknown sub-orchestrator: {name} (known: {', '.join(reg)})")
if reg[name].get('type', 'session') != 'session':
    sys.exit(f"{name} is type={reg[name]['type']}: call it with the Agent tool (subagent_type={reg[name].get('agent', name)}), not delegate.sh")
# session 型は、環境変数と引数を足せる（ローカル LLM など。ADR 0039）。許可リストにあるものだけ。台帳の側でも同じ規則で検査している
import re
ENV_KEYS = {'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
            'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
            'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
            'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'}
FLAGS = {'--tools': True, '--max-turns': True, '--model': True, '--strict-mcp-config': False, '--disable-slash-commands': False}
VALUE = re.compile(r'[A-Za-z0-9_.:/,*@-]{0,200}')
lines = [str((here / reg[name]['dir']).resolve())]
env, args = reg[name].get('env') or {}, reg[name].get('args') or []
for k, v in env.items():
    if k not in ENV_KEYS or not isinstance(v, str) or not VALUE.fullmatch(v):
        sys.exit(f'{name}: env {k} is not allowed')
    lines.append(f'E\t{k}\t{v}')
i = 0
while i < len(args):
    flag = args[i]
    if flag not in FLAGS:
        sys.exit(f'{name}: arg {flag} is not allowed')
    lines.append(f'A\t{flag}')
    if FLAGS[flag]:
        i += 1
        if i >= len(args) or not args[i] or args[i].startswith('-') or not VALUE.fullmatch(args[i]):
            sys.exit(f'{name}: {flag} needs a plain value')
        lines.append(f'A\t{args[i]}')
    i += 1
print('\n'.join(lines))
PY
)"

dir="" envs=() cargs=()
while IFS=$'\t' read -r kind a b; do
  case "$kind" in
    E) envs+=("$a=$b") ;;
    A) cargs+=("$a") ;;
    *) dir="$kind" ;;   # 1 行目（フォルダのパス。タブを含まない）
  esac
done <<<"$spec"

cd "$dir"
printf '%s' "$prompt" | exec timeout "${DELEGATE_TIMEOUT:-900}" env "${envs[@]}" "${CLAUDE_BIN:-claude}" -p "${cargs[@]}"
