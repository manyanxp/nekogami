"""オーケストレーター / エージェント / サブエージェント / ツールの台帳（JSON ファイル永続化）。"""
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .definitions import DefinitionError, DefinitionStore, entry_node, merge_tools, node_entry
from .icons import IconError, IconStore
from .shared import has_section as shared_has_section
from .pynodes import (IDENT_RE, MAX_VALUE, PY_TYPES, binding_errors, build_function, input_errors, is_function_style, params_from_inputs,
                      parse_function, parse_input)

KINDS = ('orchestrator', 'suborchestrator', 'agent', 'subagent')
# 親にできる種別。orchestrator（猫神さま）は親なし。suborchestrator は orchestrator か、別の suborchestrator の下（入れ子。ADR 0042）
MAX_DEPTH = 4   # 猫神さまを 0 として、ツリーの深さの上限。実行時の CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH と合わせる
PARENT_KINDS = {
    'orchestrator': (),
    'suborchestrator': ('orchestrator', 'suborchestrator'),
    'agent': ('orchestrator', 'suborchestrator'),
    'subagent': ('agent', 'suborchestrator', 'orchestrator'),
}
RUNTIME_TYPES = ('builtin', 'docker', 'external')
TOOL_KINDS = ('builtin', 'mcp', 'custom', 'directory', 'llm', 'python', 'input')
SPAWN_ENTRY = 'mcp__neko-spawn__*'   # 担当の自動作成（Agent Console のツール。ADR 0043）。サブオーケストレーターのスイッチで tools に入る
NODE_TOOL_KINDS = ('directory', 'llm', 'python')   # Agent Console がプロセス内の MCP サーバーとして公開するノード。定義ファイルのある担当にだけつなげる
# LLM ノード（ローカル LLM。ADR 0040）の設定。モデル名は Ollama のもの
LLM_MODEL_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$')
LLM_MAX_PROMPT = 8000
LLM_DEFAULTS = {'temperature': 0.7, 'max_tokens': 1024}
# session 型の委任先に持たせられる env と args（ADR 0039）。nekogamisama/bin/delegate.sh の許可リストと同じ規則
SESSION_ENV_KEYS = frozenset({'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
                              'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
                              'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
                              'CLAUDE_CODE_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'})
SESSION_ARG_FLAGS = {'--tools': True, '--max-turns': True, '--model': True, '--strict-mcp-config': False, '--disable-slash-commands': False}   # True = 値を取る
SESSION_VALUE_RE = re.compile(r'[A-Za-z0-9_.:/,*@-]{0,200}')


def _clean_session_env(env):
    if not isinstance(env, dict) or any(k not in SESSION_ENV_KEYS for k in env) or not all(isinstance(v, str) and SESSION_VALUE_RE.fullmatch(v) for v in env.values()):
        raise ValidationError(f'env は、{sorted(SESSION_ENV_KEYS)} をキーにした文字列のオブジェクト（値は英数字と . _ : / , * @ - のみ）')
    return dict(env)


def _clean_session_args(args):
    out, i = [], 0
    if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
        raise ValidationError('args は文字列の配列')
    while i < len(args):
        flag = args[i]
        if flag not in SESSION_ARG_FLAGS:
            raise ValidationError(f'args に使えるのは {sorted(SESSION_ARG_FLAGS)} だけ: {flag}')
        out.append(flag)
        if SESSION_ARG_FLAGS[flag]:
            if i + 1 >= len(args) or not SESSION_VALUE_RE.fullmatch(args[i + 1]) or not args[i + 1] or args[i + 1].startswith('-'):
                raise ValidationError(f'{flag} には値が要る（英数字と . _ : / , * @ - のみ）')
            out.append(args[i + 1])
            i += 1
        i += 1
    return out


DIR_PERMS = ('list', 'read', 'write', 'delete', 'exec')   # 参照（一覧）・読み込み・書き込み・削除・Python の実行（ADR 0038）
DIR_RISKY_PERMS = ('write', 'delete', 'exec')   # 担当に新しく足すとき、確認が要る権限
DIR_SEGMENT_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
DIR_MAX_DEPTH = 8
DIR_NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{0,39}$')   # MCP のサーバー名（dir-<名前>）になる。記号は置き換えられうるので、英数字とハイフンだけ
# Claude Code の組み込みツール（ノードグラフのツールパレットに出す）。台帳上のメタ情報であり、エージェントの実際の権限は変えない（ADR 0014）
BUILTIN_TOOLS = ('Agent', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit', 'Bash')
POS_LIMIT = 100000
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
SERVICE_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
SEED_NS = uuid.UUID('6f1c1a52-6b0e-4a39-9d58-3c1b7f0a2e11')  # 組み込みエンティティの決定的 UUID 用


class ValidationError(ValueError):
    pass


class NotFound(KeyError):
    pass


class Forbidden(PermissionError):
    """保護されたエンティティ（猫神さま）への操作。"""


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _clean_runtime(rt, project_dir: Path):
    rt = rt or {'type': 'external'}
    if not isinstance(rt, dict) or rt.get('type') not in RUNTIME_TYPES:
        raise ValidationError(f'runtime.type は {RUNTIME_TYPES} のいずれか')
    out = {'type': rt['type']}
    url = rt.get('url') or ''
    if url and not re.match(r'^https?://', url):
        raise ValidationError('runtime.url は http(s):// で始める')
    out['url'] = url
    if rt['type'] == 'docker':
        cf, svc = rt.get('compose_file') or '', rt.get('service') or ''
        if not cf or not svc:
            raise ValidationError('docker では runtime.compose_file と runtime.service が必要')
        if not SERVICE_RE.match(svc):
            raise ValidationError('runtime.service の形式が不正')
        p = (project_dir / cf).resolve()
        if project_dir not in p.parents or p.suffix not in ('.yml', '.yaml'):
            raise ValidationError('compose_file はプロジェクト配下の .yml/.yaml のみ指定できる')
        out.update(compose_file=str(p.relative_to(project_dir)), service=svc)
    return out


def _clean_dir_path(path):
    """ディレクトリのノードの場所。作業用の領域（Agent Console の FS_ROOT）からの相対パス。絶対パス・`..`・隠しフォルダは不可"""
    if not isinstance(path, str) or not path.strip():
        raise ValidationError('path が必要（作業領域からの相対パス。例: docs/notes）')
    path = path.strip()
    if path.startswith(('/', '\\')) or '\\' in path:
        raise ValidationError('path は相対パス（先頭の / や \\ は不可）')
    parts = path.rstrip('/').split('/')
    if len(parts) > DIR_MAX_DEPTH or not all(DIR_SEGMENT_RE.match(p) and p not in ('.', '..') for p in parts):
        raise ValidationError(f'path は英数字と . _ - の名前を / でつないだ相対パス（先頭は英数字、{DIR_MAX_DEPTH} 階層まで。.. や絶対パスは不可）')
    return '/'.join(parts)


def _clean_llm_fields(data, base=None):
    """LLM ノードの model / prompt（システムプロンプト）/ temperature / max_tokens を検証する。base があれば、指定のない項目は base の値を保つ。"""
    out = dict(base or {})
    if 'model' in data or not base:
        model = str(data.get('model') or '').strip()
        if not LLM_MODEL_RE.match(model):
            raise ValidationError('model は Ollama のモデル名（例: qwen3:8b）。英数字と . _ : / - のみ')
        out['model'] = model
    if 'prompt' in data or not base:
        prompt = data.get('prompt') or ''
        if not isinstance(prompt, str) or len(prompt) > LLM_MAX_PROMPT:
            raise ValidationError(f'プロンプトは文字列で、{LLM_MAX_PROMPT} 文字まで')
        out['prompt'] = prompt
    if 'temperature' in data or not base:
        t = data.get('temperature', LLM_DEFAULTS['temperature'])
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not 0 <= t <= 2:
            raise ValidationError('temperature は 0〜2 の数')
        out['temperature'] = float(t)
    if 'max_tokens' in data or not base:
        m = data.get('max_tokens', LLM_DEFAULTS['max_tokens'])
        if isinstance(m, bool) or not isinstance(m, int) or not 16 <= m <= 4096:
            raise ValidationError('max_tokens は 16〜4096 の整数')
        out['max_tokens'] = m
    return out


def _clean_py_fields(data, base=None, inputs=()):
    """Python ノードの code / func を検証し、引数（params）と、実行する関数のソース（source）を作る。コードは実行しない（ADR 0041・0045）
    - 旧形式（コードに `def <func>(...)` がある）: 引数は型注釈から読む。入力ノードは、その引数に合うものだけつなげる。
    - 処理だけの形式: コードは関数の中身だけ。引数は、つないだ入力ノード（inputs）から作る。実行時に関数を自動生成する。"""
    out = dict(base or {})
    code = data.get('code', out.get('code'))
    func = str(data.get('func', out.get('func', 'main')) or '').strip()
    try:
        if is_function_style(code, func):
            info = parse_function(code, func)
            out.update(style='function', code=code, func=func, params=info['params'], doc=info['doc'], source=code)
        else:
            errors = input_errors(inputs)
            if errors:
                raise ValueError('; '.join(errors))
            params = params_from_inputs(inputs)
            out.update(style='body', code=code, func=func, params=params, doc='', source=build_function(code, params, func))
    except ValueError as e:
        raise ValidationError(str(e))
    return out


def _clean_input_fields(data, base=None):
    """入力ノードの param（引数名）/ dtype（データ型）/ value（値の文字列）を検証する。値は型に従って読めなければならない"""
    out = dict(base or {})
    if 'param' in data or not base:
        param = str(data.get('param') or '').strip()
        if not IDENT_RE.match(param):
            raise ValidationError('param（引数名）は、英数字と _ からなる Python の名前')
        out['param'] = param
    if 'dtype' in data or not base:
        dtype = data.get('dtype', 'str')
        if dtype not in PY_TYPES:
            raise ValidationError(f'dtype は {PY_TYPES} のいずれか')
        out['dtype'] = dtype
    if 'value' in data or not base:
        value = data.get('value', '')
        value = '' if value is None else value
        if not isinstance(value, str) or len(value) > MAX_VALUE:
            raise ValidationError(f'value は文字列で、{MAX_VALUE} 文字まで')
        out['value'] = value
    try:
        out['parsed'] = parse_input(out['dtype'], out['value'])   # 実行側（Agent Console）が読む、型に従った値
    except ValueError as e:
        raise ValidationError(str(e))
    return out


def _clean_dir_perms(perms):
    """権限。既定はすべてオフ。指定のないものはオフ"""
    if perms is None:
        perms = {}
    if not isinstance(perms, dict) or any(k not in DIR_PERMS for k in perms):
        raise ValidationError(f'perms は {DIR_PERMS} をキーにした真偽値のオブジェクト')
    return {k: bool(perms.get(k)) for k in DIR_PERMS}


def _clean_pos(pos):
    if pos is None:
        return None
    try:
        x, y = float(pos['x']), float(pos['y'])
    except (TypeError, KeyError, ValueError):
        raise ValidationError('pos は {x, y}（数値）')
    if not (abs(x) <= POS_LIMIT and abs(y) <= POS_LIMIT):  # NaN / inf も弾く
        raise ValidationError('pos の範囲が不正')
    return {'x': round(x, 1), 'y': round(y, 1)}


class Registry:
    def __init__(self, path: Path, project_dir: Path, defs: DefinitionStore = None):
        self.path, self.project_dir = Path(path), Path(project_dir).resolve()
        self.defs = defs or DefinitionStore(self.project_dir, self.path.parent)
        self.delegate_file = self.project_dir / 'nekogamisama' / 'suborchestrators.json'
        self.icons = IconStore(self.project_dir / 'portal' / 'assets' / 'icons', self.path.parent / 'icons')
        self._lock = threading.RLock()
        self._items = {}
        self._load()
        self.sync_personas()   # 手で編集した personality.md を、定義の節へ反映する（ADR 0046）
        self.sync_shared()     # 親の Shared Principles を、使う子の定義へ反映する（ADR 0047）

    # ---- 永続化 ----
    def _load(self):
        self._tools = {}
        if not self.path.exists():
            return
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self._tools = {t['id']: t for t in data.get('tools', [])}
        for e in data.get('entities', []):
            e.setdefault('tool_ids', [])
            e.setdefault('callee_ids', [])
            e.setdefault('auto_spawn', False)
            e.setdefault('definition', None)
            e.setdefault('pos', None)
            e.setdefault('protected', False)
            e.setdefault('icon', None)
            self._items[e['id']] = e

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'version': 2, 'entities': list(self._items.values()), 'tools': list(self._tools.values())},
                      f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    # ---- 参照 ----
    def list(self, kind=None, q=None):
        with self._lock:
            items = list(self._items.values())
        if kind:
            items = [e for e in items if e['kind'] == kind]
        if q:
            q = q.lower()
            items = [e for e in items if q in (e['name'] + ' ' + e.get('description', '') + ' ' + ' '.join(e.get('tags', []))).lower()]
        order = {k: i for i, k in enumerate(KINDS)}
        return sorted(items, key=lambda e: (order[e['kind']], e['name']))

    def get(self, eid):
        with self._lock:
            if eid not in self._items:
                raise NotFound(eid)
            return dict(self._items[eid])

    def icon_users(self, ref):
        with self._lock:
            return [e['name'] for e in self._items.values() if e.get('icon') == ref]

    def _depth(self, eid):
        """猫神さま（親なし）を 0 とした深さ"""
        n, cur = 0, self._items.get(eid)
        while cur and cur.get('parent_id') in self._items and n < 100:
            cur = self._items[cur['parent_id']]
            n += 1
        return n

    def _height(self, eid):
        """eid の配下の、いちばん深い子までの段数（子がなければ 0）"""
        kids = self.children(eid)
        return 1 + max(self._height(k['id']) for k in kids) if kids else 0

    def _check_tree(self, kind, parent, current):
        """親の付け方の検査: 循環、深さの上限、サブオーケストレーターの入れ子の条件（ADR 0042）"""
        if current:
            p = parent
            while p:
                if p['id'] == current['id']:
                    raise ValidationError('子孫を親にはできない（循環）')
                p = self._items.get(p.get('parent_id'))
        below = self._height(current['id']) if current else 0
        if self._depth(parent['id']) + 1 + below > MAX_DEPTH:
            raise ValidationError(f'ツリーは {MAX_DEPTH} 階層まで（猫神さまの下を 1 とする）')
        if kind == 'suborchestrator' and parent['kind'] == 'suborchestrator':
            for who, e in (('親', parent), ('子', current)):
                if e and (e.get('definition') or {}).get('kind') != 'agent-md':
                    raise ValidationError(f'サブオーケストレーターを入れ子にできるのは、定義ファイル（.claude/agents/）のあるものだけ: {who} {e["name"]}')
            try:
                tools = self.defs.read(parent['definition'])['tools']
            except (DefinitionError, OSError) as ex:
                raise ValidationError(f'親の定義ファイルを読めない: {ex}')
            if tools is not None and not any(t.split('(')[0] == 'Agent' for t in tools):
                raise ValidationError(f'親 {parent["name"]} の tools に Agent がない（配下を呼べない）。先に Agent を足してほしい')

    def _is_top(self, e):
        """猫神さま直下のサブオーケストレーター（委任先一覧に載せる対象）"""
        return e['kind'] == 'suborchestrator' and (self._items.get(e.get('parent_id')) or {}).get('kind') == 'orchestrator'

    def children(self, eid):
        return [e for e in self._items.values() if e.get('parent_id') == eid]

    # ---- 更新 ----
    def _validate(self, data, current=None):
        kind = data.get('kind', current and current['kind'])
        if kind not in KINDS:
            raise ValidationError(f'kind は {KINDS} のいずれか')
        if current and kind != current['kind']:
            raise ValidationError('kind は変更できない')
        name = (data.get('name') or '').strip()
        protected = bool(current and current.get('protected'))
        if protected and name != current['name']:
            raise Forbidden('猫神さまの名前は変更できない')
        if protected and not data.get('enabled', True):
            raise Forbidden('猫神さまは無効化できない')
        if not NAME_RE.match(name):
            raise ValidationError('name は英数字と . _ - のみ（先頭は英数字、64 文字以内）')
        for e in self._items.values():
            if e['name'] == name and (not current or e['id'] != current['id']):
                raise ValidationError(f'name "{name}" は既に使われている')
        parent_id = data.get('parent_id') or None
        if protected and parent_id != current.get('parent_id'):
            raise Forbidden('猫神さまの親は変更できない')
        if kind == 'orchestrator':
            if parent_id:
                raise ValidationError('orchestrator は親を持てない')
        else:
            parent = self._items.get(parent_id) if parent_id else None
            if not parent or parent['kind'] not in PARENT_KINDS[kind]:
                raise ValidationError(f'{kind} の親は {PARENT_KINDS[kind]} のいずれかを指定する')
            if current and parent_id == current['id']:
                raise ValidationError('自分自身を親にできない')
            if not current or parent_id != current.get('parent_id'):   # 親を付ける・付け替えるときだけ
                self._check_tree(kind, parent, current)
        tags = data.get('tags') or []
        if not isinstance(tags, list) or not all(isinstance(t, str) and len(t) <= 32 for t in tags):
            raise ValidationError('tags は文字列の配列')
        try:
            icon = self.icons.clean_ref(data.get('icon'))
        except IconError as e:
            raise ValidationError(str(e))
        return {
            'icon': icon,
            'tool_ids': self._clean_tool_ids(data.get('tool_ids')),
            'callee_ids': self._clean_callee_ids(data.get('callee_ids'), current, kind),
            'auto_spawn': self._clean_auto_spawn(data.get('auto_spawn'), kind),
            'pos': _clean_pos(data.get('pos')),
            'kind': kind, 'name': name, 'parent_id': parent_id,
            'description': str(data.get('description') or '')[:500],
            'model': str(data.get('model') or '')[:64],
            'enabled': bool(data.get('enabled', True)),
            'tags': tags,
            'runtime': _clean_runtime(data.get('runtime'), self.project_dir),
        }

    def _clean_callee_ids(self, ids, current, kind):
        """呼べる担当（担当 → 担当の接続。ADR 0043）。自分自身・猫神さま・呼び合いの輪（循環）は不可"""
        ids = ids or []
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValidationError('callee_ids は担当の ID の配列')
        ids = list(dict.fromkeys(ids))
        for i in ids:
            t = self._items.get(i)
            if t is None:
                raise ValidationError(f'未登録の担当: {i}')
            if t['kind'] == 'orchestrator':
                raise ValidationError('猫神さまは、ほかの担当から呼べない')
            if current and i == current['id']:
                raise ValidationError('自分自身は呼べない')
        if current and ids and kind == 'orchestrator':
            raise ValidationError('猫神さまの呼び先は、委任先一覧で管理する')
        if current:
            seen, stack = set(), list(ids)
            while stack:   # 呼び先をたどって、自分に戻ってくるなら輪になる（無限に呼び合う）
                n = stack.pop()
                if n == current['id']:
                    raise ValidationError('呼び合いの輪になるので、つなげない')
                if n not in seen:
                    seen.add(n)
                    stack += (self._items.get(n) or {}).get('callee_ids', [])
        return ids

    @staticmethod
    def _clean_auto_spawn(value, kind):
        value = bool(value)
        if value and kind != 'suborchestrator':
            raise ValidationError('担当の自動作成を許せるのは、サブオーケストレーターだけ')
        return value

    def _clean_tool_ids(self, ids):
        ids = ids or []
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValidationError('tool_ids は文字列（UUID）の配列')
        unknown = [i for i in ids if i not in self._tools]
        if unknown:
            raise ValidationError(f'未登録のツール: {unknown[0]}')
        inputs = [self._tools[i]['name'] for i in ids if self._tools[i]['kind'] == 'input']
        if inputs:
            raise ValidationError(f'入力ノードは担当にはつなげない（Python ノードにつなぐ）: {", ".join(inputs)}')
        return list(dict.fromkeys(ids))

    def create(self, data, eid=None, protected=False, definition=None):
        with self._lock:
            body = self._validate(data)
            if body['kind'] == 'suborchestrator' and (self._items.get(body['parent_id']) or {}).get('kind') == 'suborchestrator' and not definition:
                raise ValidationError('入れ子のサブオーケストレーターには、定義ファイルが要る（定義ファイルつきで作る）')
            eid = eid or str(uuid.uuid4())
            e = {'id': eid, **body, 'protected': protected, 'definition': definition, 'created_at': _now(), 'updated_at': _now()}
            self._items[eid] = e
            self._save()
            return dict(e)

    def update(self, eid, patch):
        with self._lock:
            cur = self.get(eid)
            allow = bool(patch.get('allow_dangerous'))
            patch = {k: v for k, v in patch.items() if k not in ('id', 'created_at', 'updated_at', 'protected', 'definition', 'allow_dangerous')}
            body = self._validate({**cur, **patch}, current=cur)
            if body['name'] != cur['name']:
                self._rename(cur, body['name'])           # 定義ファイル・配下のフォルダ・委任先一覧の名前も合わせる
                cur = self.get(eid)
            self._check_node_connections(cur, body)
            if (body['auto_spawn'] != cur.get('auto_spawn', False) or set(body['callee_ids']) - set(cur.get('callee_ids', []))) \
                    and (cur.get('definition') or {}).get('kind') != 'agent-md':
                raise ValidationError(f'{cur["name"]} は定義ファイル（.claude/agents/）がないので、担当を呼ぶ接続と自動作成のスイッチは使えない')
            definition = self._apply_definition(cur, body, allow) if cur.get('definition') else cur.get('definition')
            try:
                self._apply_host_nodes(cur, body, allow)
            except DefinitionError as ex:
                raise ValidationError(str(ex))
            e = {**cur, **body, 'definition': definition, 'updated_at': _now()}
            was_top = self._is_top(cur)
            self._items[eid] = e
            if cur['kind'] == 'suborchestrator' and was_top != self._is_top(e) and (definition or {}).get('kind') == 'agent-md':
                self._delegate_entry(e['name'], e['description'], remove=was_top)   # 入れ子になったら委任先から外し、猫神さま直下に戻ったら載せる
            self._save()
            if body.get('parent_id') != cur.get('parent_id'):
                self.sync_shared()   # 親が変わった子は、新しい親の共通プロンプトに合わせる（親がサブオーケストレーターでなければ外す）
            return dict(e)

    def delete(self, eid, cascade=False):
        with self._lock:
            if self.get(eid).get('protected'):
                raise Forbidden('猫神さま（管理者エージェント）は削除できない')
            kids = self.children(eid)
            if kids and not cascade:
                raise ValidationError(f'子が {len(kids)} 件ある。cascade=1 で一緒に削除できる')
            stack, ids = [eid], []
            while stack:
                cur = stack.pop()
                ids.append(cur)
                stack += [c['id'] for c in self.children(cur)]
            if any(self._items[i].get('protected') for i in ids):
                raise Forbidden('猫神さま（管理者エージェント）は削除できない')
            for i in ids:
                for o in self._items.values():   # 消した担当への「呼ぶ」接続も外す
                    if i in o.get('callee_ids', []):
                        o['callee_ids'] = [c for c in o['callee_ids'] if c != i]
                e = self._items.pop(i, None)
                if e and (e.get('definition') or {}).get('kind') == 'agent-md':
                    self.defs.discard(e['definition']['path'])        # 削除ではなく trash へ移す
                    if e['kind'] == 'suborchestrator':
                        self._discard_persona(e['name'])
                if e and self._is_top(e) and (e.get('definition') or {}).get('kind') == 'agent-md':
                    self._delegate_entry(e['name'], remove=True)   # 定義ファイルごと消えるものだけ。台帳だけを外すときは委任設定を残す
            self._save()
            self.sync_shared()   # 親を消した子の節を外す
            return ids

    # ---- ツール（ノードグラフでエージェントに接続する対象）----
    def list_tools(self):
        with self._lock:
            return sorted((dict(t) for t in self._tools.values()), key=lambda t: (TOOL_KINDS.index(t['kind']), t['name']))

    def create_tool(self, data, tid=None):
        with self._lock:
            name = (data.get('name') or '').strip()
            if not NAME_RE.match(name):
                raise ValidationError('name は英数字と . _ - のみ（先頭は英数字、64 文字以内）')
            kind = data.get('kind') or 'custom'
            if kind not in TOOL_KINDS:
                raise ValidationError(f'kind は {TOOL_KINDS} のいずれか')
            if kind in NODE_TOOL_KINDS + ('input',) and not DIR_NAME_RE.match(name):
                raise ValidationError('ディレクトリ・LLM・Python・入力の名前は英数字とハイフンだけ（先頭は英数字、40 文字以内）')
            if any(t['name'] == name for t in self._tools.values()):
                raise ValidationError(f'ツール "{name}" は既に使われている')
            tid = tid or str(uuid.uuid4())
            t = {'id': tid, 'name': name, 'kind': kind, 'description': str(data.get('description') or '')[:300],
                 'pos': _clean_pos(data.get('pos')), 'created_at': _now()}
            if kind == 'directory':
                t['path'] = _clean_dir_path(data.get('path'))
                t['perms'] = _clean_dir_perms(data.get('perms'))
            if kind == 'llm':
                t.update(_clean_llm_fields(data))
            if kind == 'python':
                t.update(_clean_py_fields(data))
                t['input_ids'] = []
            if kind == 'input':
                t.update(_clean_input_fields(data))
            self._tools[tid] = t
            self._save()
            return dict(t)

    def update_tool(self, tid, patch):
        with self._lock:
            if tid not in self._tools:
                raise NotFound(tid)
            if 'pos' in patch:  # 変更できるのは配置と説明だけ
                self._tools[tid]['pos'] = _clean_pos(patch['pos'])
            if 'description' in patch:
                self._tools[tid]['description'] = str(patch['description'] or '')[:300]
            if self._tools[tid]['kind'] == 'directory':   # 場所と権限は、ディレクトリのノードだけ
                if 'path' in patch:
                    self._tools[tid]['path'] = _clean_dir_path(patch['path'])
                if 'perms' in patch:
                    self._tools[tid]['perms'] = _clean_dir_perms(patch['perms'])
            elif 'path' in patch or 'perms' in patch:
                raise ValidationError('path と perms を持てるのは、ディレクトリのノードだけ')
            if self._tools[tid]['kind'] == 'llm':   # モデル・プロンプト・温度・出力上限は、LLM ノードだけ
                self._tools[tid].update(_clean_llm_fields(patch, base=self._tools[tid]))
            elif any(k in patch for k in ('model', 'prompt', 'temperature', 'max_tokens')):
                raise ValidationError('model・prompt・temperature・max_tokens を持てるのは、LLM ノードだけ')
            kind = self._tools[tid]['kind']
            if kind == 'python':   # 処理（コード）と入力のつなぎ。引数と関数は、つないだ入力ノードから作り直す
                new = dict(self._tools[tid])
                if 'input_ids' in patch:
                    new['input_ids'] = self._clean_input_ids(patch['input_ids'])
                self._tools[tid].update(self._rebuild_py(new, patch, [self._tools[i] for i in new.get('input_ids', [])]))
            elif kind == 'input':   # 値・型・引数名。つなぎ先の Python ノードの引数と関数も作り直す（合わなくなる変更は、受け付けない）
                new = _clean_input_fields(patch, base=self._tools[tid])
                rebuilt = [(p, self._rebuild_py(dict(p), {}, [new if i == tid else self._tools[i] for i in p['input_ids']]))
                           for p in self._tools.values() if p['kind'] == 'python' and tid in p.get('input_ids', [])]
                self._tools[tid].update(new)
                for p, np in rebuilt:
                    p.update(np)
            elif any(k in patch for k in ('code', 'func', 'input_ids', 'param', 'dtype', 'value')):
                raise ValidationError('code・func・input_ids は Python ノード、param・dtype・value は入力ノードだけが持てる')
            self._save()
            return dict(self._tools[tid])

    def _clean_input_ids(self, ids):
        if not isinstance(ids, list) or not all(isinstance(i, str) and self._tools.get(i, {}).get('kind') == 'input' for i in ids):
            raise ValidationError('input_ids は、入力ノードの ID の配列')
        return list(dict.fromkeys(ids))

    def _rebuild_py(self, py, patch, inputs):
        """Python ノードの引数と関数のソースを、コードと入力ノードから作り直す。合わなければ ValidationError"""
        new = _clean_py_fields(patch, base=py, inputs=inputs)
        if new['style'] == 'function':   # 旧形式: 入力ノードは、関数の引数に合うものだけ
            self._check_bindings(new, inputs)
        return new

    @staticmethod
    def _check_bindings(py, inputs):
        errors = binding_errors(py.get('params', []), inputs)
        if errors:
            raise ValidationError(f'Python ノード {py["name"]} と入力ノードが合わない: ' + '; '.join(errors))

    def delete_tool(self, tid):
        with self._lock:
            if tid not in self._tools:
                raise NotFound(tid)
            if self._tools[tid]['kind'] in NODE_TOOL_KINDS:
                self._detach_directory(self._tools[tid]['name'])
            del self._tools[tid]
            for t in self._tools.values():   # 消した入力ノードは、Python ノードの入力から外す
                if tid in t.get('input_ids', []):
                    t['input_ids'] = [i for i in t['input_ids'] if i != tid]
                    try:
                        t.update(self._rebuild_py(dict(t), {}, [self._tools[i] for i in t['input_ids']]))
                    except ValidationError:
                        pass   # 作り直せなくても、削除は止めない（次に保存したときに検査される）
            for e in self._items.values():
                if tid in e['tool_ids']:
                    e['tool_ids'] = [i for i in e['tool_ids'] if i != tid]
                    e['updated_at'] = _now()
            self._save()

    def _detach_directory(self, name):
        """消すディレクトリのノードの項目（mcp__dir-<名前>__*）を、担当の定義ファイルから外す。
        残すと、同じ名前でノードを作り直したときに、確認なしで担当につながってしまう（ADR 0037）。"""
        for e in self._items.values():
            d = e.get('definition')
            if not d or d['kind'] == 'claude-md':
                continue
            try:
                tools = self.defs.read(d)['tools']
                if tools and any(entry_node(t) == name for t in tools):
                    self.defs.write(d, tools=[t for t in tools if entry_node(t) != name])
            except DefinitionError as ex:
                raise ValidationError(f'{e["name"]} の定義ファイルから接続を外せなかった: {ex}')

    def _seed_tools(self):
        """組み込みツールと .mcp.json の MCP サーバーをツールとして登録する（UUID v5。冪等）。"""
        names = [(n, 'builtin') for n in BUILTIN_TOOLS]
        try:
            servers = json.loads((self.project_dir / '.mcp.json').read_text(encoding='utf-8')).get('mcpServers', {})
        except (OSError, ValueError):
            servers = {}
        names += [(n, 'mcp') for n in servers if NAME_RE.match(n)]
        for name, kind in names:
            tid = str(uuid.uuid5(SEED_NS, f'tool:{name}'))
            if tid not in self._tools and not any(t['name'] == name for t in self._tools.values()):
                self._tools[tid] = {'id': tid, 'name': name, 'kind': kind, 'pos': None, 'created_at': _now(),
                                    'description': 'MCP サーバー（.mcp.json）' if kind == 'mcp' else 'Claude Code 組み込みツール'}

    # ---- Claude のエージェント定義（.claude/agents/）との連携（ADR 0016）----
    def _tool_names(self, tool_ids):
        return [self._tools[i]['name'] for i in tool_ids if i in self._tools]

    def _catalog(self):
        return {t['name']: t['kind'] for t in self._tools.values()}

    def _ids_from_entries(self, entries):
        by_name = {t['name']: t['id'] for t in self._tools.values()}
        return list(dict.fromkeys(by_name[n] for n in (entry_node(x) for x in (entries or [])) if n in by_name))

    def _group_for(self, body, name):
        """定義ファイルを置くフォルダ名。猫神さま直下のサブオーケストレーターは自分の名前、それ以外は親の名前
        （入れ子のサブオーケストレーターも親のフォルダに置く。自分の配下は、自分の名前のフォルダ）。"""
        parent = self._items.get(body.get('parent_id')) or {}
        if body['kind'] == 'suborchestrator' and parent.get('kind') != 'suborchestrator':
            return name
        return parent['name']

    def _node_host(self, cur):
        """ディレクトリ・LLM のノードのツール（定義ファイルの tools）を書き込む先の担当。
        - エージェント定義（.claude/agents/）のある担当は、自分自身。
        - サブオーケストレーターは、委任先（suborchestrators.json で type=agent のもの）の担当。`azure-sage` と話すとき、実際に動くのは委任先の
          `azure-architect` なので、サブオーケストレーターへの接続は、そのツールになる（ADR 0040）。
        - 猫神さま（CLAUDE.md）や、委任先のない担当は None（つないでも実行時に効かない）。"""
        if (cur.get('definition') or {}).get('kind') == 'agent-md':
            return cur
        if cur['kind'] != 'suborchestrator':
            return None
        try:
            entry = self._delegate_read().get(cur['name']) or {}
        except ValidationError:
            return None
        if entry.get('type') != 'agent':
            return None
        host = next((x for x in self._items.values() if x['name'] == entry.get('agent') and (x.get('definition') or {}).get('kind') == 'agent-md'), None)
        return host

    def _node_changes(self, cur, body):
        """今回の変更で、新しくつなぐノードと、外すノード（ディレクトリ・LLM だけ）"""
        added = [self._tools[i] for i in set(body['tool_ids']) - set(cur['tool_ids']) if i in self._tools and self._tools[i]['kind'] in NODE_TOOL_KINDS]
        removed = [self._tools[i] for i in set(cur['tool_ids']) - set(body['tool_ids']) if i in self._tools and self._tools[i]['kind'] in NODE_TOOL_KINDS]
        return added, removed

    def _check_node_connections(self, cur, body):
        """ディレクトリ・LLM のノードを新しくつなげるのは、ツールを書ける担当（上の `_node_host`）だけ。
        猫神さまや定義のない担当につないでも、実行時には何も効かないので、黙って受け付けない。"""
        added, _ = self._node_changes(cur, body)
        if added and self._node_host(cur) is None:
            raise ValidationError(f'{cur["name"]} は、ツールを書ける定義ファイル（.claude/agents/）も、委任先のエージェントも持たないので、ノードをつなげない: {", ".join(sorted(t["name"] for t in added))}')

    def _apply_host_nodes(self, cur, body, allow_dangerous):
        """サブオーケストレーターへの接続を、委任先の担当の定義ファイルに反映する（自分の定義には tools がないため）。"""
        host = self._node_host(cur)
        if host is None or host['id'] == cur['id']:
            return
        added, removed = self._node_changes(cur, body)
        if not added and not removed:
            return
        self._check_risky(added, allow_dangerous)
        d = dict(host['definition'])
        try:
            tools = [t for t in (self.defs.read(d)['tools'] or []) if entry_node(t) not in {r['name'] for r in removed}]
            have = {entry_node(t) for t in tools}
            tools += [node_entry(t['name'], t['kind']) for t in added if t['name'] not in have]
            self.defs.write(d, tools=tools)
        except DefinitionError as ex:
            raise ValidationError(str(ex))
        ids = [i for i in host['tool_ids'] if i not in {r['id'] for r in removed}] + [t['id'] for t in added if t['id'] not in host['tool_ids']]
        self._items[host['id']] = {**host, 'tool_ids': ids, 'updated_at': _now()}

    @staticmethod
    def _check_risky(added, allow_dangerous):
        risky = sorted(t['name'] for t in added if t['kind'] == 'directory' and any((t.get('perms') or {}).get(k) for k in DIR_RISKY_PERMS))
        if risky and not allow_dangerous:
            raise DefinitionError(f'書き込み・削除・Python 実行ができるディレクトリを新しく足すには確認が必要: {", ".join(risky)}')

    def _apply_definition(self, cur, body, allow_dangerous):
        """エンティティの変更を定義ファイルへ反映する（台帳を保存する前に呼ぶ。失敗したら台帳も変えない）。"""
        d = dict(cur['definition'])
        try:
            if d['kind'] == 'claude-md':
                if body['model'] != cur['model']:
                    self.defs.write(d, model=body['model'])
                return d
            tools = None
            if body['tool_ids'] != cur['tool_ids']:
                self._check_risky([self._tools[i] for i in set(body['tool_ids']) - set(cur['tool_ids']) if i in self._tools], allow_dangerous)
                current = self.defs.read(d)['tools'] or []
                tools = merge_tools(current, self._tool_names(body['tool_ids']), self._catalog())
            tools = self._apply_calls(d, cur, body, tools)
            self.defs._check(body['description'], body['model'], tools)
            if body['parent_id'] != cur['parent_id']:
                d['path'] = self.defs.move(d['path'], self._group_for(body, body['name']))
            self.defs.write(d, description=body['description'] if body['description'] != cur['description'] else None,
                            model=body['model'] if body['model'] != cur['model'] else None,
                            tools=tools, allow_dangerous=allow_dangerous)
            return d
        except DefinitionError as e:
            raise ValidationError(str(e))

    def _apply_calls(self, d, cur, body, tools):
        """自動作成のスイッチ（mcp__neko-spawn__*）と、担当を呼ぶ接続（Agent ツール）を、定義の tools に反映する。変更がなければ tools をそのまま返す"""
        spawn_changed = body['auto_spawn'] != cur.get('auto_spawn', False)
        added_callee = bool(set(body['callee_ids']) - set(cur.get('callee_ids', [])))
        if not spawn_changed and not added_callee:
            return tools
        base = tools if tools is not None else self.defs.read(d)['tools']
        if base is None:        # tools の指定がない = 全ツールを継承。足さなくても使える
            return tools
        out = list(base)
        if spawn_changed:
            out = [t for t in out if t != SPAWN_ENTRY]
            if body['auto_spawn']:
                out.append(SPAWN_ENTRY)
        if added_callee and not any(t.split('(')[0] == 'Agent' for t in out):
            out.insert(0, 'Agent')   # 呼ぶには Agent ツールが要る
        return out

    def _rename(self, cur, new):
        """名前の変更に伴うファイル操作。先にぶつかりを全部調べてから動かす。台帳（_items）は、定義のパスと名前だけを更新する。"""
        old = cur['name']
        taken = {a['name'] for a in self.defs.scan()}
        if new in taken:
            raise ValidationError(f'定義の名前 "{new}" は既に使われている（.claude/agents/ 以下）')
        kids = [e for e in self._items.values() if e.get('parent_id') == cur['id'] and (e.get('definition') or {}).get('kind') == 'agent-md'
                and e['definition']['path'].split('/')[2:3] == [old]]
        d = cur.get('definition')
        moves = []                                          # (entity_id, 新しい definition)
        try:
            own_new = None
            if d and d['kind'] == 'agent-md':
                group = self._group_for(cur, new)
                own_new = self.defs.agent_path(group, new)
                if own_new != d['path'] and self.defs.exists(own_new):
                    raise DefinitionError(f'{own_new} は既にある')
            for k in kids:
                kp = self.defs.agent_path(new, k['definition']['path'].rsplit('/', 1)[1][:-3])
                if self.defs.exists(kp):
                    raise DefinitionError(f'{kp} は既にある')
            if own_new:
                moves.append((cur['id'], {'kind': 'agent-md', 'path': self.defs.rename(d['path'], new, own_new.split('/')[2])}))
            for k in kids:
                moves.append((k['id'], {'kind': 'agent-md', 'path': self.defs.move(k['definition']['path'], new)}))
        except DefinitionError as e:
            raise ValidationError(str(e))
        for eid, nd in moves:
            self._items[eid]['definition'] = nd
        self._delegate_rename(old, new)
        self._move_persona(old, new)

    def get_definition(self, eid):
        e = self.get(eid)
        if not e.get('definition'):
            raise ValidationError('このエンティティには定義ファイルがない')
        try:
            r = self.defs.read(e['definition'])
        except (DefinitionError, OSError) as ex:
            raise ValidationError(f'定義ファイルを読めない: {ex}')
        from .definitions import unmapped_entries
        r['tools_other'] = unmapped_entries(r['tools'], self._catalog())   # グラフで操作できない項目（読み取り専用で表示）
        return r

    # ---- Shared Principles（ADR 0047）----
    def _is_sub_md(self, e):
        return bool(e) and e['kind'] == 'suborchestrator' and (e.get('definition') or {}).get('kind') == 'agent-md'

    def _shared_children(self, e):
        return [c for c in self._items.values() if c.get('parent_id') == e['id'] and c['kind'] in ('agent', 'subagent', 'suborchestrator')]

    def get_shared(self, eid):
        """Shared Principles の画面用データ。サブオーケストレーターなら本文と直下の子の一覧、サブオーケストレーターの子なら使う／使わないの状態"""
        from . import shared
        e = self.get(eid)
        parent = self._items.get(e.get('parent_id'))
        out = {'name': e['name']}
        if self._is_sub_md(e):
            out.update(text=shared.read_file(self.project_dir, e['name']), children=[
                {'id': c['id'], 'name': c['name'], 'kind': c['kind'], 'eligible': (c.get('definition') or {}).get('kind') == 'agent-md',
                 'use': self._uses_shared(c)} for c in sorted(self._shared_children(e), key=lambda c: c['name'])])
        if self._is_sub_md(parent):
            out['as_child'] = {'parent': parent['name'], 'parent_text': shared.read_file(self.project_dir, parent['name']),
                               'eligible': (e.get('definition') or {}).get('kind') == 'agent-md', 'use': self._uses_shared(e)}
        if 'text' not in out and 'as_child' not in out:
            raise ValidationError('Shared Principles を使えるのは、サブオーケストレーターと、その直下の子だけ')
        return out

    def _uses_shared(self, e):
        try:
            return (e.get('definition') or {}).get('kind') == 'agent-md' and shared_has_section(self.get_definition(e['id'])['prompt'])
        except ValidationError:
            return False

    def set_shared(self, eid, text):
        """親の共通プロンプトを保存し、使っている子の定義へ反映する"""
        from . import shared
        with self._lock:
            e = self.get(eid)
            if not self._is_sub_md(e):
                raise ValidationError('共通プロンプトを持てるのは、定義ファイルのあるサブオーケストレーターだけ')
            try:
                shared.write_file(self.project_dir, e['name'], text, self.defs)
            except shared.SharedError as ex:
                raise ValidationError(str(ex))
            self.sync_shared()
            return self.get_shared(eid)

    def set_use_shared(self, eid, use):
        """子が、親の Shared Principles を使うかを切り替える（使うなら、定義の本文に節を足す）"""
        from . import shared
        with self._lock:
            e = self.get(eid)
            parent = self._items.get(e.get('parent_id'))
            if not self._is_sub_md(parent):
                raise ValidationError('親がサブオーケストレーター（定義ファイルあり）のときだけ使える')
            if (e.get('definition') or {}).get('kind') != 'agent-md':
                raise ValidationError('定義ファイルのない担当には渡せない')
            prompt = self.get_definition(eid)['prompt']
            text = shared.read_file(self.project_dir, parent['name']) if use else None
            new = shared.apply(prompt, text, parent['name'])
            if new.strip() != prompt.strip():
                self.set_prompt(eid, new)
            return self.get_shared(eid)

    def sync_shared(self):
        """節を持つ子の定義を、今の親の共通プロンプトに合わせる。親が変わった・いなくなった子は、節を外す"""
        from . import shared
        with self._lock:
            for e in list(self._items.values()):
                if (e.get('definition') or {}).get('kind') != 'agent-md':
                    continue
                try:
                    prompt = self.get_definition(e['id'])['prompt']
                    if not shared.has_section(prompt):
                        continue
                    parent = self._items.get(e.get('parent_id'))
                    new = shared.apply(prompt, shared.read_file(self.project_dir, parent['name']) if self._is_sub_md(parent) else None,
                                       parent['name'] if parent else '')
                    if new.strip() != prompt.strip():
                        self.set_prompt(e['id'], new)
                except ValidationError:
                    pass   # 壊れた定義は、その担当だけ飛ばす

    def _discard_persona(self, name):
        from . import personality
        from . import shared
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        for d, tag in ((personality.persona_file(self.project_dir, name).parent, 'persona'), (shared.shared_file(self.project_dir, name).parent, 'shared')):
            if d.is_dir():
                self.defs.trash.mkdir(parents=True, exist_ok=True)
                shutil.move(str(d), str(self.defs.trash / f'{tag}__{name}.{stamp}'))

    def _move_persona(self, old, new):
        """名前の変更に合わせて、personality.md のフォルダも移す（移せなければそのまま。次の保存で新しい名前に作られる）"""
        from . import personality, shared
        src, dst = personality.persona_file(self.project_dir, old).parent, personality.persona_file(self.project_dir, new).parent
        if src.is_dir() and not dst.exists():
            shutil.move(str(src), str(dst))
        s2, d2 = shared.shared_file(self.project_dir, old).parent, shared.shared_file(self.project_dir, new).parent
        if s2.is_dir() and not d2.exists():
            shutil.move(str(s2), str(d2))
        self.sync_shared()

    def _persona_target(self, eid):
        e = self.get(eid)
        if e['kind'] != 'suborchestrator' or (e.get('definition') or {}).get('kind') != 'agent-md':
            raise ValidationError('性格を設定できるのは、定義ファイルのあるサブオーケストレーターだけ（猫神さまは personality.md）')
        return e

    def get_persona(self, eid):
        """サブオーケストレーターの性格。nekogamisama/personalities/<名前>/personality.md が正で、定義の本文の節は自動生成（ADR 0046）。
        ファイルがなければ、定義の本文の節（手書きを含む）を読む。ファイルがあって節とずれていれば、節を合わせる"""
        from . import personality
        e = self._persona_target(eid)
        f = personality.read_persona_file(self.project_dir, e['name'])
        if f is None:
            return {**personality.read_section(self.get_definition(eid)['prompt']), 'name': e['name'], 'file': False}
        self._sync_persona(e, f)
        return {**f, 'name': e['name'], 'file': True}

    def _sync_persona(self, e, f):
        """personality.md の内容を、定義の本文の「性格・話し方」の節へ写す（違うときだけ書く）"""
        from . import personality
        prompt = self.get_definition(e['id'])['prompt']
        new = personality.write_section(prompt, f, name=e['name'])
        if new.strip() != prompt.strip():
            self.set_prompt(e['id'], new)

    def sync_personas(self):
        """personality.md のあるサブオーケストレーターすべてで、定義の節を合わせる。手で編集したファイルを反映する"""
        from . import personality
        with self._lock:
            for e in list(self._items.values()):
                if e['kind'] == 'suborchestrator' and (e.get('definition') or {}).get('kind') == 'agent-md':
                    f = personality.read_persona_file(self.project_dir, e['name'])
                    if f is not None:
                        try:
                            self._sync_persona(e, f)
                        except (ValidationError, personality.PersonalityError):
                            pass   # 壊れたファイルや定義は、その担当だけ飛ばす

    def set_persona(self, eid, data):
        from . import personality
        with self._lock:
            e = self._persona_target(eid)
            try:
                f = personality.write_persona_file(self.project_dir, e['name'], data, self.defs)
                self._sync_persona(e, f)
            except personality.PersonalityError as ex:
                raise ValidationError(str(ex))
            return self.get_persona(eid)

    def set_prompt(self, eid, prompt):
        with self._lock:
            e = self.get(eid)
            if not e.get('definition'):
                raise ValidationError('このエンティティには定義ファイルがない')
            try:
                self.defs.write(e['definition'], prompt=prompt)
            except DefinitionError as ex:
                raise ValidationError(str(ex))
            self._items[eid]['updated_at'] = _now()
            self._save()
            return self.get_definition(eid)

    def create_claude(self, data):
        """Claude のエージェント定義ファイル（.claude/agents/<フォルダ>/<name>.md）を作り、台帳に登録する。"""
        with self._lock:
            kind = data.get('kind')
            if kind not in ('suborchestrator', 'agent', 'subagent'):
                raise ValidationError('定義ファイルを作れるのは suborchestrator / agent / subagent')
            body = self._validate({**data, 'tool_ids': data.get('tool_ids') or []})
            name = body['name']
            from .definitions import DEFAULT_TOOLS
            if data.get('tool_ids') is None:   # 指定がなければ、読み取り中心の既定のツール
                body['tool_ids'] = self._ids_from_entries([t for t in DEFAULT_TOOLS[kind]])
            tools = merge_tools([], self._tool_names(body['tool_ids']), self._catalog())
            try:
                rel = self.defs.create(self._group_for(body, name), name, role=kind, description=body['description'] or name,
                                       model=body['model'], tools=tools, prompt=str(data.get('prompt') or ''))
            except DefinitionError as e:
                raise ValidationError(str(e))
            eid = str(uuid.uuid4())
            e = {'id': eid, **body, 'description': body['description'] or name, 'protected': False,
                 'definition': {'kind': 'agent-md', 'path': rel}, 'created_at': _now(), 'updated_at': _now()}
            self._items[eid] = e
            if self._is_top(e):
                self._delegate_entry(name, e['description'])
            self._save()
            return dict(e)

    # ---- 委任先一覧（nekogamisama/suborchestrators.json）----
    def _delegate_read(self):
        f = self.delegate_file
        try:
            data = json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}
        except (OSError, ValueError):
            raise ValidationError('suborchestrators.json を JSON として読めない。手で直してください')
        if not isinstance(data, dict):
            raise ValidationError('suborchestrators.json はオブジェクトでなければならない')
        return data

    def _delegate_write(self, data):
        f = self.delegate_file
        if not f.parent.is_dir():
            raise ValidationError('nekogamisama/ フォルダがない')
        self.defs._backup(f)                                      # 書き換え前の退避（git 管理外のため）
        fd, tmp = tempfile.mkstemp(dir=f.parent, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        os.replace(tmp, f)

    def delegation_list(self):
        with self._lock:
            return self._delegate_read()

    def delegation_put(self, name, entry):
        """委任先 1 件の追加・更新。session 型の dir は、プロジェクト配下の既存フォルダだけ（猫神さまはそこで claude -p を実行する）。"""
        with self._lock:
            if not isinstance(entry, dict):
                raise ValidationError('項目はオブジェクト')
            typ = entry.get('type') or 'session'
            desc = str(entry.get('description') or '')[:300]
            if typ == 'agent':
                if not NAME_RE.match(name):
                    raise ValidationError('name は英数字と . _ - のみ')
                target = str(entry.get('agent') or name)
                if target not in {a['name'] for a in self.defs.scan()}:
                    raise ValidationError(f'agent "{target}" の定義が .claude/agents/ にない（先にノードグラフで作る）')
                new = {'type': 'agent', 'agent': target, 'description': desc}
            elif typ == 'session':
                if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', name):
                    raise ValidationError('session 型の name は小文字・数字・ハイフンのみ（delegate.sh の規則）')
                rel = str(entry.get('dir') or '').strip()
                if not rel:
                    raise ValidationError('session 型には dir（実行するフォルダ）が必要')
                p = (self.delegate_file.parent / rel).resolve()
                if not p.is_dir() or (p != self.project_dir and self.project_dir not in p.parents):
                    raise ValidationError('dir はプロジェクト配下の既存フォルダを指定する')
                new = {'type': 'session', 'dir': os.path.relpath(p, self.delegate_file.parent), 'description': desc}
                old = self._delegate_read().get(name) or {}
                for key, clean in (('env', _clean_session_env), ('args', _clean_session_args)):   # 指定がなければ、今の値を保つ（画面の編集で消えない）
                    value = entry[key] if key in entry else old.get(key)
                    if value:
                        new[key] = clean(value)
            else:
                raise ValidationError("type は 'agent' か 'session'")
            data = self._delegate_read()
            data[name] = new
            self._delegate_write(data)
            return new

    def delegation_delete(self, name):
        with self._lock:
            data = self._delegate_read()
            if name not in data:
                raise NotFound(name)
            del data[name]
            self._delegate_write(data)

    def _delegate_entry(self, name, description='', remove=False):
        """サブオーケストレーターの追加・削除に合わせた自動更新。type=agent の項目だけを触り、session 型は変えない。"""
        try:
            data = self._delegate_read()
        except ValidationError:
            return
        if not self.delegate_file.parent.is_dir():
            return
        cur = data.get(name)
        if remove:
            if not (cur and cur.get('type') == 'agent'):
                return
            del data[name]
        else:
            if cur and cur.get('type', 'session') != 'agent':
                return
            data[name] = {'type': 'agent', 'agent': name, 'description': description}
        self._delegate_write(data)

    def _delegate_rename(self, old, new):
        try:
            data = self._delegate_read()
        except ValidationError:
            return
        if old not in data or not self.delegate_file.parent.is_dir():
            return
        data = {(new if k == old else k): v for k, v in data.items()}      # 並び順を保つ
        if data[new].get('type') == 'agent' and data[new].get('agent') == old:
            data[new]['agent'] = new
        self._delegate_write(data)

    # ---- 管理ページ用の概要 ----
    def admin_overview(self, delegate_file=None):
        """猫神さま（保護されたエンティティ）の状態と、委任先設定（suborchestrators.json）・定義ファイルと台帳の突き合わせ。"""
        with self._lock:
            neko = next((dict(e) for e in self._items.values() if e.get('protected')), None)
            subs = {e['name']: dict(e) for e in self._items.values() if self._is_top(e)}   # 委任先に載るのは、猫神さま直下だけ
            count = {k: sum(1 for e in self._items.values() if e['kind'] == k) for k in KINDS}
            for e in subs.values():
                e['children'] = sum(1 for c in self._items.values() if c.get('parent_id') == e['id'])
            misplaced, missing = [], []
            for e in self._items.values():
                d = e.get('definition') or {}
                if d.get('kind') != 'agent-md':
                    continue
                if not self.defs.exists(d['path']):
                    missing.append({'id': e['id'], 'name': e['name'], 'path': d['path']})
                    continue
                parts = d['path'].split('/')
                want = e['name'] if self._is_top(e) else (self._items.get(e['parent_id']) or {}).get('name')
                if want and (len(parts) != 4 or parts[2] != want):
                    misplaced.append({'id': e['id'], 'name': e['name'], 'path': d['path'], 'expected': f'.claude/agents/{want}/{e["name"]}.md'})
        try:
            wired = json.loads(Path(delegate_file or self.delegate_file).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            wired = {}
        delegation = [{'name': n, 'registered': n in subs, 'wired': n in wired, 'type': (wired.get(n) or {}).get('type', 'session'),
                       'dir': (wired.get(n) or {}).get('dir'), 'agent': (wired.get(n) or {}).get('agent'),
                       'description': (wired.get(n) or {}).get('description', ''), 'entity_id': subs.get(n, {}).get('id'),
                       'entity': self._entity_brief(subs.get(n)), 'target': self._target_brief((wired.get(n) or {}).get('agent')),
                       'local_model': self._local_model(wired.get(n))}
                      for n in sorted(set(subs) | set(wired))]
        return {'admin': neko, 'counts': count, 'tools': len(self._tools), 'delegation': delegation,
                'misplaced': misplaced, 'missing': missing}

    @staticmethod
    def _local_model(entry):
        """session 型で、ローカル LLM（ANTHROPIC_BASE_URL を差し替えたもの）を使う委任先の、モデル名。画面は Claude のモデルの代わりにこれを出す。"""
        env = (entry or {}).get('env') or {}
        return (env.get('ANTHROPIC_MODEL') or env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL') or 'ローカル LLM') if env.get('ANTHROPIC_BASE_URL') else None

    @staticmethod
    def _entity_brief(e):
        """委任先の表で、台帳側を編集するための要約（定義ファイルのある台帳は、登録の解除ができない）。"""
        return None if e is None else {'id': e['id'], 'description': e['description'], 'model': e['model'], 'enabled': e['enabled'],
                                       'has_definition': bool(e.get('definition')), 'children': e.get('children', 0)}

    def _target_brief(self, name):
        e = next((x for x in self._items.values() if x['name'] == name), None) if name else None
        return None if e is None else {'id': e['id'], 'name': e['name'], 'kind': e['kind']}

    # ---- 取り込み（猫神さま、Azure Sage、.claude/agents/ 以下の定義）----
    def sync_builtin(self, console_url):
        """台帳を、定義ファイルに合わせて更新する（定義ファイルが正）。冪等。
        - orchestrator `nekogamisama`（猫神さま。全体の最上位。削除不可）
        - suborchestrator `azure-sage`（Phase 1 で orchestrator として登録済みなら ID を保ったまま移行）
        - `.claude/agents/` 以下の各定義: 台帳にあれば model / description / ツール接続を定義ファイルから更新、無ければ登録
          （親は フォルダ名のエンティティ。フォルダ直下の定義は azure-sage の配下。role: suborchestrator は猫神さま直下）"""
        created = []
        with self._lock:
            self._seed_tools()
            neko_id = str(uuid.uuid5(SEED_NS, 'orchestrator:nekogamisama'))
            if neko_id not in self._items:
                self.create({'kind': 'orchestrator', 'name': 'nekogamisama', 'model': 'sonnet',
                             'description': '猫神さま。全サブオーケストレーターとエージェントを束ねる最上位の指揮役（管理者エージェント。削除不可）',
                             'tags': ['builtin', 'admin'], 'runtime': {'type': 'builtin', 'url': console_url}},
                            eid=neko_id, protected=True)
                created.append('nekogamisama')
            elif not self._items[neko_id].get('protected'):  # Phase 2 の台帳を移行
                self._items[neko_id] = {**self._items[neko_id], 'protected': True, 'enabled': True, 'updated_at': _now()}
            # azure-sage の ID は Phase 1 から変えない（seed 名も 'orchestrator:azure-sage' のまま）
            root_id = str(uuid.uuid5(SEED_NS, 'orchestrator:azure-sage'))
            cur = self._items.get(root_id)
            if cur is None:
                self.create({'kind': 'suborchestrator', 'name': 'azure-sage', 'parent_id': neko_id, 'model': 'sonnet',
                             'description': 'Azure 調査・開発提案のサブオーケストレーター（CLAUDE.md）。猫神さまから委任を受ける',
                             'tags': ['builtin'], 'runtime': {'type': 'builtin', 'url': console_url}}, eid=root_id)
                created.append('azure-sage')
            elif cur['kind'] == 'orchestrator':  # Phase 1 の台帳を移行
                self._items[root_id] = {**cur, 'kind': 'suborchestrator', 'parent_id': neko_id, 'updated_at': _now()}
                created.append('azure-sage (migrated)')
            # 指揮役の CLAUDE.md と model（settings.json）を紐づける
            for eid, rel in ((neko_id, 'nekogamisama/CLAUDE.md'), (root_id, 'CLAUDE.md')):
                if (self.project_dir / rel).is_file():
                    self._items[eid]['definition'] = {'kind': 'claude-md', 'path': rel}
                    model = self._settings_model(rel)
                    if model:
                        self._items[eid]['model'] = model
            # .claude/agents/ 以下の定義
            for a in self.defs.scan():
                ent = next((e for e in self._items.values() if e['name'] == a['name']), None)
                if ent is not None:
                    if ent['kind'] in ('orchestrator',):
                        continue
                    ent.update(definition={'kind': 'agent-md', 'path': a['path']}, model=a['model'],
                               description=a['description'] or ent['description'], tool_ids=self._ids_from_entries(a['tools']))
                else:
                    try:
                        created.append(self._register_file(a, neko_id, root_id))
                    except ValidationError:
                        continue      # 1 つの不正な定義で同期全体を止めない
                ent = next(e for e in self._items.values() if e['name'] == a['name'])
                if self._is_top(ent):
                    self._delegate_entry(ent['name'], ent['description'])
            self._save()
        return created

    def _settings_model(self, claude_md_rel):
        try:
            return json.loads((self.project_dir / claude_md_rel.replace('CLAUDE.md', '.claude/settings.json')).read_text(encoding='utf-8')).get('model') or ''
        except (OSError, ValueError):
            return ''

    def _register_file(self, a, neko_id, root_id):
        name, group = a['name'], a['group']
        if a['role'] == 'suborchestrator':
            kind, parent = 'suborchestrator', neko_id
            outer = next((e for e in self._items.values() if e['name'] == group and e['kind'] == 'suborchestrator' and group != name
                          and (e.get('definition') or {}).get('kind') == 'agent-md'), None)
            if outer:   # 別のサブオーケストレーターのフォルダにある。入れ子（ADR 0042）
                parent = outer['id']
        else:
            parent = next((e['id'] for e in self._items.values() if e['name'] == group and e['kind'] in ('orchestrator', 'suborchestrator', 'agent')), None) \
                if group else root_id
            if parent is None:
                parent = neko_id
            kind = a['role'] if a['role'] in ('agent', 'subagent') else ('agent' if self._items[parent]['kind'] == 'orchestrator' else 'subagent')
            if kind == 'agent' and self._items[parent]['kind'] not in ('orchestrator', 'suborchestrator'):
                kind = 'subagent'
        sid = str(uuid.uuid5(SEED_NS, f'subagent:{name}'))
        self.create({'kind': kind, 'name': name, 'parent_id': parent, 'model': a['model'], 'description': a['description'][:500],
                     'tags': ['builtin'] if group == 'azure-sage' or not group else [], 'tool_ids': self._ids_from_entries(a['tools']),
                     'runtime': {'type': 'builtin'}}, eid=sid, definition={'kind': 'agent-md', 'path': a['path']})
        return name
