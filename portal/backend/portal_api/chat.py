"""猫神さまとのチャット: / コマンド、Agent Console の SSE の絞り込み、Agent Console への中継。"""
import json
import re

import httpx

from . import config
from .registry import ValidationError

CHAT_AGENT = 'nekogamisama'   # ポータルのチャットの相手は猫神さま固定（Agent Console に渡す agent）
MAX_CHAT_CHARS = 8000
CMD_RE = re.compile(r'^/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:[ \t\r\n]+([\s\S]*))?$')


def chat_commands(reg):
    """チャットの / コマンドの一覧（ADR 0026）: 猫神さまの委任先（suborchestrators.json）と、定義のあるエージェント。
    name は一意。委任先の名前を優先する。"""
    items = []
    try:
        deleg = reg.delegation_list()
    except ValidationError:
        deleg = {}
    for name, e in deleg.items():
        if CMD_RE.match('/' + name):
            kind = e.get('type', 'session')
            how = f"Agent ツール、subagent_type={e.get('agent', name)}" if kind == 'agent' else 'bin/delegate.sh'
            items.append({'name': name, 'kind': 'delegate', 'type': kind, 'how': how, 'description': str(e.get('description') or '')[:120]})
    seen = {i['name'] for i in items}
    for e in reg.list():
        if (e.get('definition') or {}).get('kind') == 'agent-md' and e['name'] not in seen:
            items.append({'name': e['name'], 'kind': 'agent', 'type': e['kind'], 'how': f"Agent ツール、subagent_type={e['name']}", 'description': e['description'][:120]})
            seen.add(e['name'])
    return items


def expand_command(reg, message):
    """`/名前 依頼文` を、猫神さまへの「指名」つきの依頼にする。先頭が / でなければそのまま。
    先頭に空白を付けると、/ で始まる文章もそのまま送れる。"""
    if not message.startswith('/'):
        return message
    m = CMD_RE.match(message)
    if not m:
        raise ValidationError('コマンド名が必要（例: /azure-sage 依頼文）。先頭に空白を入れると、/ で始まる文をそのまま送れる')
    name, rest = m[1], (m[2] or '').strip()
    cmd = next((c for c in chat_commands(reg) if c['name'] == name), None)
    if cmd is None:
        raise ValidationError(f'未知のコマンド /{name}。/ で候補を表示できる（/help で一覧）。先頭に空白を入れると、/ で始まる文をそのまま送れる')
    if not rest:
        raise ValidationError(f'/{name} の後ろに依頼文が必要')
    return f"[指名: {name}（{cmd['how']}）]\n{rest}"


def filter_chat_event(line, user=None):
    """Agent Console の SSE（/events）の 1 行から、猫神さまとのチャットに必要なものだけを残す。それ以外は None。
    トレース（フック）や他のエージェントとの会話はポータルに流さない。"""
    if line.startswith(':'):  # keep-alive
        return line
    if not line.startswith('data:'):
        return None
    try:
        ev = json.loads(line[5:])
    except ValueError:
        return None
    kind = ev.get('kind')
    if kind == 'hook' and ev.get('chat') == CHAT_AGENT and ev.get('chatUser') == user:
        t = trace_event(ev)
        return None if t is None else 'data: ' + json.dumps(t, ensure_ascii=False)
    if kind == 'hello':
        mine = any(m.get('target') == CHAT_AGENT and m.get('user') == user for m in ev.get('runningChats') or [])
        return 'data: ' + json.dumps({'kind': 'hello', 'running': mine})
    if kind == 'chat' and ev.get('agent') == CHAT_AGENT and ev.get('user') == user:
        return line
    if kind == 'reset' and ev.get('agent') in (None, CHAT_AGENT) and ev.get('user') == user:
        return 'data: ' + json.dumps({'kind': 'reset'})
    return None


TRACE_EVENTS = ('PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop')
DELEGATE_RE = re.compile(r"delegate\.sh\s+([a-z0-9][a-z0-9-]*)")


def _clip(v, n):
    return v if not isinstance(v, str) or len(v) <= n else v[:n] + '…'


def trace_event(ev):
    """猫神さまとのチャット中のフックイベントを、ポータルに見せる最小限の形（trace）にする。
    どのエージェントが選ばれたかを route に取り出す: Agent ツール（subagent_type）→ via=agent、delegate.sh → via=session。"""
    name = ev.get('event')
    if name not in TRACE_EVENTS:
        return None
    out = {'kind': 'trace', 'ts': ev.get('ts'), 'event': name, 'agentType': ev.get('agentType'), 'agentId': ev.get('agentId'),
           'sessionId': (ev.get('sessionId') or '')[:8], 'toolName': ev.get('toolName'), 'toolUseId': ev.get('toolUseId'),
           'message': _clip(ev.get('message'), 400), 'prompt': _clip(ev.get('prompt'), 300)}
    if ev.get('replay'):
        out['replay'] = True
    if name == 'PreToolUse':
        try:
            inp = json.loads(ev.get('input') or '{}')
        except ValueError:
            inp = {}
        if not isinstance(inp, dict):
            inp = {}
        tool = ev.get('toolName') or ''
        if isinstance(ev.get('route'), dict) and ev['route'].get('to'):
            pass                                                              # Agent Console が取り出した route を使う（下）
        elif tool in ('Agent', 'Task') and inp.get('subagent_type'):
            out['route'] = {'to': str(inp['subagent_type'])[:64], 'via': 'agent', 'description': _clip(str(inp.get('description') or ''), 120)}
        elif tool == 'Bash' and DELEGATE_RE.search(str(inp.get('command') or '')):
            out['route'] = {'to': DELEGATE_RE.search(inp['command'])[1], 'via': 'session', 'description': ''}
        if isinstance(ev.get('route'), dict) and ev['route'].get('to'):    # Agent Console が、切る前の入力から取り出したもの
            r = ev['route']
            out['route'] = {'to': str(r['to'])[:64], 'via': 'session' if r.get('via') == 'session' else 'agent', 'description': _clip(str(r.get('description') or ''), 120)}
        out['input'] = _clip(inp.get('file_path') or inp.get('pattern') or inp.get('query') or inp.get('url') or inp.get('command')
                             or inp.get('description') or '', 200)
    return out


class ConsoleDown(RuntimeError):
    """Agent Console に接続できない"""


def _down(e):
    return ConsoleDown(f'Agent Console に接続できない ({config.CONSOLE_URL})。dashboard で npm start を実行してください: {e}')


async def console_post(path, body):
    """Agent Console へ JSON を POST し、(status, dict) を返す。接続できなければ ConsoleDown。"""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(config.CONSOLE_URL.rstrip('/') + path, json=body)
    except httpx.HTTPError as e:
        raise _down(e)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {'error': f'Agent Console が {r.status_code} を返した'}


async def console_get(path):
    """Agent Console へ GET し、JSON を返す。接続できなければ ConsoleDown。"""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(config.CONSOLE_URL.rstrip('/') + path)
            return r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise _down(e)


async def open_events():
    """Agent Console の SSE（/events）を開く。(client, response) を返す。呼び出し側が閉じる。"""
    client = httpx.AsyncClient(timeout=httpx.Timeout(10, read=None))
    try:
        resp = await client.send(client.build_request('GET', config.CONSOLE_URL.rstrip('/') + '/events'), stream=True)
        return client, resp
    except httpx.HTTPError as e:
        await client.aclose()
        raise _down(e)
