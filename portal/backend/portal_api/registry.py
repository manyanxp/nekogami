"""オーケストレーター / エージェント / サブエージェント / ツールの台帳（JSON ファイル永続化）。"""
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .definitions import DefinitionError, DefinitionStore, entry_node, merge_tools
from .icons import IconError, IconStore

KINDS = ('orchestrator', 'suborchestrator', 'agent', 'subagent')
# 親にできる種別。orchestrator（猫神さま）は親なし。suborchestrator は orchestrator の直下
PARENT_KINDS = {
    'orchestrator': (),
    'suborchestrator': ('orchestrator',),
    'agent': ('orchestrator', 'suborchestrator'),
    'subagent': ('agent', 'suborchestrator', 'orchestrator'),
}
RUNTIME_TYPES = ('builtin', 'docker', 'external')
TOOL_KINDS = ('builtin', 'mcp', 'custom')
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

    # ---- 永続化 ----
    def _load(self):
        self._tools = {}
        if not self.path.exists():
            return
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self._tools = {t['id']: t for t in data.get('tools', [])}
        for e in data.get('entities', []):
            e.setdefault('tool_ids', [])
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
            'pos': _clean_pos(data.get('pos')),
            'kind': kind, 'name': name, 'parent_id': parent_id,
            'description': str(data.get('description') or '')[:500],
            'model': str(data.get('model') or '')[:64],
            'enabled': bool(data.get('enabled', True)),
            'tags': tags,
            'runtime': _clean_runtime(data.get('runtime'), self.project_dir),
        }

    def _clean_tool_ids(self, ids):
        ids = ids or []
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValidationError('tool_ids は文字列（UUID）の配列')
        unknown = [i for i in ids if i not in self._tools]
        if unknown:
            raise ValidationError(f'未登録のツール: {unknown[0]}')
        return list(dict.fromkeys(ids))

    def create(self, data, eid=None, protected=False, definition=None):
        with self._lock:
            body = self._validate(data)
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
            definition = self._apply_definition(cur, body, allow) if cur.get('definition') else cur.get('definition')
            e = {**cur, **body, 'definition': definition, 'updated_at': _now()}
            self._items[eid] = e
            self._save()
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
                e = self._items.pop(i, None)
                if e and (e.get('definition') or {}).get('kind') == 'agent-md':
                    self.defs.discard(e['definition']['path'])        # 削除ではなく trash へ移す
                if e and e['kind'] == 'suborchestrator' and (e.get('definition') or {}).get('kind') == 'agent-md':
                    self._delegate_entry(e['name'], remove=True)   # 定義ファイルごと消えるものだけ。台帳だけを外すときは委任設定を残す
            self._save()
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
            if any(t['name'] == name for t in self._tools.values()):
                raise ValidationError(f'ツール "{name}" は既に使われている')
            tid = tid or str(uuid.uuid4())
            t = {'id': tid, 'name': name, 'kind': kind, 'description': str(data.get('description') or '')[:300],
                 'pos': _clean_pos(data.get('pos')), 'created_at': _now()}
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
            self._save()
            return dict(self._tools[tid])

    def delete_tool(self, tid):
        with self._lock:
            if tid not in self._tools:
                raise NotFound(tid)
            del self._tools[tid]
            for e in self._items.values():
                if tid in e['tool_ids']:
                    e['tool_ids'] = [i for i in e['tool_ids'] if i != tid]
                    e['updated_at'] = _now()
            self._save()

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
        """定義ファイルを置くフォルダ名。サブオーケストレーターは自分の名前、それ以外は親の名前。"""
        if body['kind'] == 'suborchestrator':
            return name
        return self._items[body['parent_id']]['name']

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
                current = self.defs.read(d)['tools'] or []
                tools = merge_tools(current, self._tool_names(body['tool_ids']), self._catalog())
            self.defs._check(body['description'], body['model'], tools)
            if body['kind'] != 'suborchestrator' and body['parent_id'] != cur['parent_id']:
                d['path'] = self.defs.move(d['path'], self._group_for(body, body['name']))
            self.defs.write(d, description=body['description'] if body['description'] != cur['description'] else None,
                            model=body['model'] if body['model'] != cur['model'] else None,
                            tools=tools, allow_dangerous=allow_dangerous)
            return d
        except DefinitionError as e:
            raise ValidationError(str(e))

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
                group = new if cur['kind'] == 'suborchestrator' else self._items[cur['parent_id']]['name']
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
            if kind == 'suborchestrator':
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
            subs = {e['name']: dict(e) for e in self._items.values() if e['kind'] == 'suborchestrator'}
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
                want = e['name'] if e['kind'] == 'suborchestrator' else (self._items.get(e['parent_id']) or {}).get('name')
                if want and (len(parts) != 4 or parts[2] != want):
                    misplaced.append({'id': e['id'], 'name': e['name'], 'path': d['path'], 'expected': f'.claude/agents/{want}/{e["name"]}.md'})
        try:
            wired = json.loads(Path(delegate_file or self.delegate_file).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            wired = {}
        delegation = [{'name': n, 'registered': n in subs, 'wired': n in wired, 'type': (wired.get(n) or {}).get('type', 'session'),
                       'dir': (wired.get(n) or {}).get('dir'), 'agent': (wired.get(n) or {}).get('agent'),
                       'description': (wired.get(n) or {}).get('description', ''), 'entity_id': subs.get(n, {}).get('id'),
                       'entity': self._entity_brief(subs.get(n)), 'target': self._target_brief((wired.get(n) or {}).get('agent'))}
                      for n in sorted(set(subs) | set(wired))]
        return {'admin': neko, 'counts': count, 'tools': len(self._tools), 'delegation': delegation,
                'misplaced': misplaced, 'missing': missing}

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
                if ent['kind'] == 'suborchestrator':
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
