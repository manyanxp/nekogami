"""Shared Principles — サブオーケストレーターが、直下の子（エージェント・子サブオーケストレーター）へ渡す共通プロンプト（ADR 0047）。
正は nekogamisama/shared/<親の名前>/shared-principles.md。使うと決めた子の定義ファイルの本文に、「## Shared Principles」の節として自動生成する。"""
import os
import re
import tempfile
from pathlib import Path

DIR = Path('nekogamisama') / 'shared'
FILE = 'shared-principles.md'
LIMIT = 4000
HEADING = 'Shared Principles'
SECTION_RE = re.compile(rf'^## {HEADING}[^\n]*\n(.*?)(?=^## |\Z)', re.S | re.M)
NOTE = '<!-- 自動生成: 親 {parent} の Shared Principles（nekogamisama/shared/{parent}/shared-principles.md が正）。ここを直接編集しても、次の同期で上書きされる -->'
LEAD = '以下は、親の {parent} から全員に共通で渡される指示。自分の役割のプロンプトと合わせて従う。'


class SharedError(ValueError):
    pass


def shared_file(project_dir, name):
    return Path(project_dir) / DIR / name / FILE


def clean(text):
    if not isinstance(text, str):
        raise SharedError('text は文字列')
    text = '\n'.join(ln.rstrip() for ln in text.replace('@', '＠').replace('\r', '').strip().split('\n'))
    if len(text) > LIMIT:
        raise SharedError(f'共通プロンプトは {LIMIT} 文字まで')
    if re.search(r'^#{1,6}\s', text, re.M):
        raise SharedError('見出し（#）は使えない（箇条書きや文章で書く）')
    return text


def read_file(project_dir, name):
    p = shared_file(project_dir, name)
    return p.read_text(encoding='utf-8').strip() if p.is_file() else ''


def write_file(project_dir, name, text, defs):
    text = clean(text)
    p = shared_file(project_dir, name)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.is_file():
        defs._backup(p)
    fd, tmp = tempfile.mkstemp(dir=p.parent, suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    os.replace(tmp, p)
    return text


def has_section(prompt):
    return SECTION_RE.search(prompt or '') is not None


def render_section(text, parent):
    body = f'\n{text}\n' if text else ''
    return f'## {HEADING}（全エージェント共通指示）\n\n{NOTE.format(parent=parent)}\n\n{LEAD.format(parent=parent)}\n{body}'


def apply(prompt, text, parent):
    """プロンプトの節を、text（None なら削除）に合わせる。戻り値: 新しい本文"""
    prompt = prompt or ''
    if text is None:
        return SECTION_RE.sub('', prompt, count=1).rstrip('\n') + '\n' if has_section(prompt) else prompt
    section = render_section(text, parent)
    if has_section(prompt):
        return SECTION_RE.sub(lambda _m: section + '\n', prompt, count=1).rstrip('\n') + '\n'
    return prompt.rstrip('\n') + '\n\n' + section
