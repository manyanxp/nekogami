"""Claude Code のエージェント定義ファイルの読み書き（ADR 0016）。

対象は次の 3 種類だけ。パスは呼び出し側が組み立てた「プロジェクトからの相対パス」ではなく、このモジュールが
名前（検証済み）から決める。API の入力から任意のパスは受け取らない。
  - .claude/agents/<フォルダ>/<name>.md   サブエージェント / サブオーケストレーターの定義（frontmatter + プロンプト本文）
  - CLAUDE.md / nekogamisama/CLAUDE.md     指揮役（猫神さま・Azure Sage）のプロンプト
  - .claude/settings.json / nekogamisama/.claude/settings.json の model

書き換える前に portal/data/backups/ へ退避し、削除は portal/data/trash/ への移動にする（git 管理外のため）。
frontmatter は、編集するキー（description / model / tools）だけを差し替え、ほかの行（effort / color / disallowedTools など）は
そのまま残す。permissionMode など権限に関わるキーは扱わない。
"""
import errno
import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

AGENTS_DIR = Path('.claude') / 'agents'
NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
MODEL_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
TOOL_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_*.-]{0,127}(\([A-Za-z0-9_, .*-]{0,200}\))?$')
ROLES = ('suborchestrator', 'agent', 'subagent')
# 書き込み・実行ができるツール。新しく足すときは確認（allow_dangerous）が要る（ADR 0002 の読み取り中心の方針）
DANGEROUS_TOOLS = ('Bash', 'Write', 'Edit', 'NotebookEdit')
LLM_PREFIX = 'llm-'   # LLM ノード（ローカル LLM）は、Agent Console が MCP サーバー `llm-<名前>` として公開する（ADR 0040）
DIR_PREFIX = 'dir-'   # ディレクトリのノードは、Agent Console が MCP サーバー `dir-<名前>` として公開する（ADR 0037）
MAX_PROMPT = 50_000
KEY_RE = re.compile(r'^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$')
# 新規作成時の既定ツール（読み取り中心。tools を省略すると全ツールを継承してしまうので、必ず明示する）
DEFAULT_TOOLS = {
    'suborchestrator': ['Agent', 'Read', 'Glob', 'Grep'],
    'agent': ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    'subagent': ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
}


class DefinitionError(ValueError):
    pass


# ---------------------------------------------------------------- frontmatter
class Doc:
    """frontmatter をキーごとのブロック（先頭行 + 継続行）に分けて保持する。編集しないブロックは逐語で残る。"""

    def __init__(self, text):
        self.blocks = []     # [[key, first_value, [continuation lines]]]
        self.body = text
        self.has_fm = False
        lines = text.split('\n')
        if lines and lines[0].rstrip('\r') == '---':
            end = next((i for i in range(1, len(lines)) if lines[i].rstrip('\r') == '---'), None)
            if end is not None:
                self.has_fm = True
                for ln in lines[1:end]:
                    m = KEY_RE.match(ln)
                    if m:
                        self.blocks.append([m[1], m[2], []])
                    elif self.blocks:
                        self.blocks[-1][2].append(ln)
                self.body = '\n'.join(lines[end + 1:])

    def get(self, key):
        for b in self.blocks:
            if b[0] == key:
                return b
        return None

    def scalar(self, key):
        b = self.get(key)
        return _unquote(b[1].strip()) if b else ''

    def tools(self, key='tools'):
        """tools を配列で返す。キーが無ければ None（= 全ツールを継承）。"""
        b = self.get(key)
        if b is None:
            return None
        items = [x.strip() for x in b[1].split(',')] if b[1].strip() else []
        for ln in b[2]:
            ln = ln.strip()
            if ln.startswith('-'):
                items.append(ln[1:].strip())
        return [_unquote(x) for x in items if x]

    def set(self, key, value, *, first=False):
        b = self.get(key)
        if b:
            b[1], b[2] = value, []
        elif first:
            self.blocks.insert(0, [key, value, []])
        else:
            self.blocks.append([key, value, []])

    def dump(self):
        out = ['---']
        for k, v, cont in self.blocks:
            out.append(f'{k}: {v}'.rstrip() if v else f'{k}:')
            out.extend(cont)
        out.append('---')
        return '\n'.join(out) + '\n' + self.body


def _body(text):
    """frontmatter の後ろに置く本文。元のファイルと同じく、閉じの --- の次に空行を 1 つ入れる。"""
    return '\n' + text.strip('\n') + '\n'


def _unquote(v):
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if len(v) >= 2 and v[0] == "'" and v[-1] == "'":
        return v[1:-1].replace("''", "'")
    return v


def _yaml_scalar(v):
    """1 行の YAML スカラー。`: ` や ` #` を含む、記号で始まるなどの値は二重引用符で囲む（JSON 文字列は YAML の二重引用符として有効）。"""
    if v == '' or v != v.strip() or ': ' in v or ' #' in v or v[0] in '[]{}&*!|>\'"%@`#,-?:' or v.lower() in ('true', 'false', 'null', 'yes', 'no', '~') \
            or re.fullmatch(r'[-+]?[0-9.]+', v):
        return json.dumps(v, ensure_ascii=False)
    return v


# ---------------------------------------------------------------- ツール名 ⇔ ノード名
def entry_node(entry):
    """tools の 1 項目が属するノード名。MCP は `mcp__サーバー__…` → サーバー名、`Agent(a,b)` → Agent。"""
    base = entry.split('(')[0]
    if base.startswith('mcp__'):
        server = base.split('__')[1] if base.count('__') >= 1 else ''
        if server.startswith(DIR_PREFIX) and len(server) > len(DIR_PREFIX):
            return server[len(DIR_PREFIX):]   # ディレクトリのノード（`mcp__dir-<名前>__*`）。ノード名は <名前>
        if server.startswith(LLM_PREFIX) and len(server) > len(LLM_PREFIX):
            return server[len(LLM_PREFIX):]   # LLM ノード（`mcp__llm-<名前>__*`）
        return server or None
    return base


def node_entry(name, kind):
    if kind == 'directory':
        return f'mcp__{DIR_PREFIX}{name}__*'
    if kind == 'llm':
        return f'mcp__{LLM_PREFIX}{name}__*'
    return f'mcp__{name}__*' if kind == 'mcp' else name


def merge_tools(existing, wanted, catalog):
    """既存の tools を、グラフで選んだツール（wanted: ノード名の配列）に合わせて更新する。
    - 外れたノードの項目は消す。残るノードの項目（例: mcp__server__個別ツール）は元のまま残す。
    - カタログにないツール名の項目（例: TodoWrite）は、グラフで操作できないので残す。
    catalog: {ノード名: kind}"""
    wanted = list(dict.fromkeys(wanted))
    kept = [e for e in (existing or []) if entry_node(e) not in catalog or entry_node(e) in wanted]
    covered = {entry_node(e) for e in kept}
    return kept + [node_entry(n, catalog[n]) for n in wanted if n in catalog and n not in covered]


def unmapped_entries(entries, catalog):
    return [e for e in (entries or []) if entry_node(e) not in catalog]


# ---------------------------------------------------------------- ストア
class DefinitionStore:
    def __init__(self, project_dir: Path, data_dir: Path):
        self.root = Path(project_dir).resolve()
        self.agents = self.root / AGENTS_DIR
        self.backups = Path(data_dir) / 'backups'
        self.trash = Path(data_dir) / 'trash'

    # ---- パス ----
    def _abs(self, rel):
        p = (self.root / rel).resolve()
        if self.agents.resolve() not in p.parents or p.suffix != '.md':
            raise DefinitionError('定義ファイルは .claude/agents/ 配下の .md のみ')
        return p

    def agent_path(self, group, name):
        for part in (group, name):
            if not NAME_RE.match(part or ''):
                raise DefinitionError('フォルダ名・名前は英数字と . _ - のみ')
        return str((AGENTS_DIR / group / f'{name}.md').as_posix())

    def exists(self, rel):
        return self._abs(rel).is_file()

    # ---- 走査 ----
    def scan(self):
        """`.claude/agents/` 以下を再帰的に読み、定義の一覧を返す。"""
        out = []
        if not self.agents.is_dir():
            return out
        for f in sorted(self.agents.rglob('*.md')):
            if any(part.startswith('.') for part in f.relative_to(self.agents).parts):
                continue
            try:
                d = Doc(f.read_text(encoding='utf-8'))
            except (OSError, UnicodeDecodeError):
                continue
            if not d.has_fm or not d.scalar('name'):
                continue
            rel = f.relative_to(self.root).as_posix()
            parts = f.relative_to(self.agents).parts
            out.append({'path': rel, 'group': parts[0] if len(parts) > 1 else '', 'name': d.scalar('name'), 'role': d.scalar('role') or 'subagent',
                        'description': d.scalar('description'), 'model': d.scalar('model'), 'tools': d.tools()})
        return out

    # ---- 読み取り ----
    def read(self, definition):
        kind, rel = definition['kind'], definition['path']
        if kind == 'claude-md':
            return {'kind': kind, 'path': rel, 'prompt': self._claude_md(rel).read_text(encoding='utf-8'), 'tools': None}
        d = Doc(self._abs(rel).read_text(encoding='utf-8'))
        return {'kind': kind, 'path': rel, 'name': d.scalar('name'), 'description': d.scalar('description'), 'model': d.scalar('model'),
                'tools': d.tools(), 'prompt': d.body.strip('\n')}

    def _claude_md(self, rel):
        if rel not in ('CLAUDE.md', 'nekogamisama/CLAUDE.md'):
            raise DefinitionError('編集できる CLAUDE.md は CLAUDE.md と nekogamisama/CLAUDE.md のみ')
        return self.root / rel

    def _settings(self, claude_md_rel):
        return self.root / (claude_md_rel.replace('CLAUDE.md', '.claude/settings.json'))

    # ---- 書き込み ----
    def _backup(self, p: Path):
        if p.is_file():
            self.backups.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            shutil.copy2(p, self.backups / f"{p.relative_to(self.root).as_posix().replace('/', '__').lstrip('.')}.{stamp}")

    def _atomic(self, p: Path, text):
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=p.parent, suffix='.tmp')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        try:
            os.replace(tmp, p)
        except OSError as e:
            if e.errno != errno.EBUSY:   # ファイル単体のバインドマウント（compose の CLAUDE.md）は、置き換えられない。その場で書く
                raise
            p.write_text(text, encoding='utf-8')
            os.unlink(tmp)

    @staticmethod
    def _check(description=None, model=None, tools=None, prompt=None):
        if description is not None and (len(description) > 1000 or '\n' in description or '\r' in description):
            raise DefinitionError('description は 1 行・1000 文字まで')
        if model is not None and model != '' and not MODEL_RE.match(model):
            raise DefinitionError('model の形式が不正')
        if tools is not None and not (isinstance(tools, list) and all(isinstance(t, str) and TOOL_RE.match(t) for t in tools)):
            raise DefinitionError('tools は、英数字・_ * . - からなるツール名の配列')
        if prompt is not None and (not isinstance(prompt, str) or len(prompt) > MAX_PROMPT):
            raise DefinitionError(f'プロンプトは {MAX_PROMPT} 文字まで')

    def write(self, definition, *, description=None, model=None, tools=None, prompt=None, allow_dangerous=False):
        """None の項目は変更しない。tools は項目の配列（merge_tools の結果）。"""
        self._check(description, model, tools, prompt)
        kind, rel = definition['kind'], definition['path']
        if kind == 'claude-md':
            if prompt is not None:
                p = self._claude_md(rel)
                self._backup(p); self._atomic(p, prompt.rstrip('\n') + '\n')
            if model is not None:
                self._set_settings_model(self._settings(rel), model)
            return
        p = self._abs(rel)
        d = Doc(p.read_text(encoding='utf-8'))
        if tools is not None:
            added = set(tools) - set(d.tools() or [])
            risky = sorted(t for t in added if t.split('(')[0] in DANGEROUS_TOOLS)
            if risky and not allow_dangerous:
                raise DefinitionError(f'書き込み・実行ができるツールを新しく足すには確認が必要: {", ".join(risky)}')
            d.set('tools', ', '.join(tools))
        if description is not None:
            d.set('description', _yaml_scalar(description))
        if model is not None:
            if model == '':
                d.blocks = [b for b in d.blocks if b[0] != 'model']
            else:
                d.set('model', model)
        if prompt is not None:
            d.body = _body(prompt)
        self._backup(p); self._atomic(p, d.dump())

    def _set_settings_model(self, p: Path, model):
        text = p.read_text(encoding='utf-8')
        try:
            data = json.loads(text)
        except ValueError:
            raise DefinitionError(f'{p.name} が JSON として読めない')
        if model == '':
            raise DefinitionError('指揮役のモデルは空にできない（settings.json の model）')
        if 'model' in data:
            new = re.sub(r'("model"\s*:\s*)"[^"\n]*"', lambda m: f'{m[1]}{json.dumps(model)}', text, count=1)
        else:
            new = re.sub(r'^\{', f'{{\n  "model": {json.dumps(model)},', text, count=1)
        if json.loads(new).get('model') != model:
            raise DefinitionError('settings.json の model を安全に書き換えられなかった')
        self._backup(p); self._atomic(p, new)

    def create(self, group, name, *, role, description, model='', tools=None, prompt=''):
        self._check(description, model, tools, prompt)
        if role not in ROLES:
            raise DefinitionError(f'role は {ROLES}')
        rel = self.agent_path(group, name)
        if self._abs(rel).exists():
            raise DefinitionError(f'{rel} は既にある')
        tools = tools if tools is not None else DEFAULT_TOOLS[role]
        risky = [t for t in tools if t.split('(')[0] in DANGEROUS_TOOLS]
        if risky:
            raise DefinitionError(f'新規作成では書き込み・実行ができるツールは付けられない（作成後にグラフで接続する）: {", ".join(risky)}')
        d = Doc('')
        d.has_fm = True
        d.blocks = [['name', name, []], ['description', _yaml_scalar(description or name), []], ['role', role, []]]
        if model:
            d.blocks.append(['model', model, []])
        d.blocks.append(['tools', ', '.join(tools), []])
        d.body = _body(prompt.strip('\n') or default_prompt(role, name, description, group))
        self._atomic(self._abs(rel), d.dump())
        return rel

    def move(self, rel, new_group):
        """定義ファイルを別のフォルダへ移す（親の付け替えに合わせる）。移動後のパスを返す。"""
        src = self._abs(rel)
        dst_rel = self.agent_path(new_group, src.stem)
        dst = self._abs(dst_rel)
        if dst == src:
            return rel
        if dst.exists():
            raise DefinitionError(f'{dst_rel} は既にある')
        dst.parent.mkdir(parents=True, exist_ok=True)
        self._backup(src)
        shutil.move(str(src), str(dst))
        self._prune(src.parent)
        return dst_rel

    def rename(self, rel, new_name, new_group):
        """定義の name とファイル名を変え、new_group のフォルダへ置く。新しいパスを返す（元のファイルは backups に退避して削除）。"""
        src = self._abs(rel)
        dst_rel = self.agent_path(new_group, new_name)
        dst = self._abs(dst_rel)
        if dst != src and dst.exists():
            raise DefinitionError(f'{dst_rel} は既にある')
        d = Doc(src.read_text(encoding='utf-8'))
        d.set('name', new_name)
        self._backup(src)
        self._atomic(dst, d.dump())
        if dst != src:
            src.unlink()
            self._prune(src.parent)
        return dst_rel

    def discard(self, rel):
        """削除ではなく trash へ移す。"""
        src = self._abs(rel)
        if not src.is_file():
            return
        self.trash.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        shutil.move(str(src), str(self.trash / f"{rel.replace('/', '__').lstrip('.')}.{stamp}"))
        self._prune(src.parent)

    def _prune(self, d: Path):
        """空になったグループのフォルダを片付ける（.claude/agents 自体は残す）。"""
        try:
            if d != self.agents and self.agents in d.parents and not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass


def default_prompt(role, name, description, group):
    desc = description or '（役割をここに書く）'
    if role == 'suborchestrator':
        return (f'あなたはサブオーケストレーター「{name}」です。{desc}\n\n'
                f'## 役割\n'
                f'- 自分では長い調査や作業をせず、配下のエージェントに分担させて、結果を統合して答える。\n'
                f'- 配下のエージェントの定義は `.claude/agents/{name}/` にある。一覧は Glob で確認し、Agent ツールで起動する。\n\n'
                f'## 守ること\n'
                f'- 事実と推測を分け、出典があれば示す。\n'
                f'- 依頼されていない作成・変更・削除はしない。\n')
    return (f'あなたは「{name}」です。{desc}\n\n'
            f'## 役割\n'
            f'- 依頼された観点に絞って調べ、結果を簡潔にまとめて返す。\n\n'
            f'## 守ること\n'
            f'- 事実と推測を分け、出典があれば示す。\n'
            f'- 読み取りと提案のみ。作成・変更・削除はしない。\n')
