"""猫神さまの性格（nekogamisama/personality.md）の読み書き（ADR 0021）。
CLAUDE.md が `@personality.md` で取り込む。性格は猫神さま自身の言葉づかいにだけ使い、手順・権限・出典の扱いは変えない。
ファイルは人が手で編集してもよい。書き換え前は portal/data/backups へ退避する。"""
import os
import re
import tempfile
from pathlib import Path

FILE = Path('nekogamisama') / 'personality.md'
IMPORT_LINE = '@personality.md'
LIMITS = {'first_person': 16, 'address': 16, 'tone': 80, 'traits': 1000}
DEFAULTS = {'first_person': 'わたし', 'address': 'あなた', 'tone': 'ていねいな「です・ます」調', 'traits': '落ち着いていて、面倒見がよい。ときどき猫らしいしぐさで場をなごませる。'}
HEADER = '# 猫神さまの性格\n\n<!-- 「猫神さま管理」ページから編集できます。手で編集してもかまいません。 -->\n\n'
FIELD_RE = {k: re.compile(rf'^- {label}:[ \t]*(.*)$', re.M) for k, label in (('first_person', '一人称'), ('address', '呼びかけ'), ('tone', '口調'))}


class PersonalityError(ValueError):
    pass


def _clean(key, v):
    if not isinstance(v, str):
        raise PersonalityError(f'{key} は文字列')
    v = v.replace('@', '＠').replace('\r', '')      # `@path` は CLAUDE.md の import として解釈されるので、本文には入れない
    if key != 'traits':
        v = ' '.join(v.split())
    else:
        v = '\n'.join(line.rstrip() for line in v.strip().split('\n'))
    if len(v) > LIMITS[key]:
        raise PersonalityError(f'{key} は {LIMITS[key]} 文字まで')
    if key != 'traits' and not v:
        raise PersonalityError(f'{key} は空にできない')
    if re.search(r'^#{1,6}\s', v, re.M):
        raise PersonalityError('見出し（#）は使えない（箇条書きや文章で書く）')
    return v


def render(f):
    return (HEADER + f"- 一人称: {f['first_person']}\n- 呼びかけ: {f['address']}\n- 口調: {f['tone']}\n\n"
            f"## 性格・ふるまい\n\n{f['traits']}\n")


def parse(text):
    f = dict(DEFAULTS)
    for k, rx in FIELD_RE.items():
        m = rx.search(text)
        if m and m[1].strip():
            f[k] = m[1].strip()
    m = re.search(r'^## 性格・ふるまい[ \t]*\n+(.*?)\s*\Z', text, re.S | re.M)
    if m is not None:
        f['traits'] = m[1].strip()
    return f


def read(project_dir):
    p = Path(project_dir) / FILE
    claude_md = Path(project_dir) / 'nekogamisama' / 'CLAUDE.md'
    imported = claude_md.is_file() and IMPORT_LINE in claude_md.read_text(encoding='utf-8').split()
    exists = p.is_file()
    f = parse(p.read_text(encoding='utf-8')) if exists else dict(DEFAULTS)
    return {**f, 'exists': exists, 'imported': imported, 'preview': render(f)}


def write(project_dir, data, defs):
    f = {k: _clean(k, data.get(k, DEFAULTS[k])) for k in LIMITS}
    p = Path(project_dir) / FILE
    if not p.parent.is_dir():
        raise PersonalityError('nekogamisama/ フォルダがない')
    defs._backup(p)
    fd, tmp = tempfile.mkstemp(dir=p.parent, suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write(render(f))
    os.replace(tmp, p)
    return read(project_dir)


def enable_import(project_dir, defs):
    """nekogamisama/CLAUDE.md に `@personality.md` の行がなければ、末尾の「性格・話し方」の節として足す。"""
    p = Path(project_dir) / 'nekogamisama' / 'CLAUDE.md'
    if not p.is_file():
        raise PersonalityError('nekogamisama/CLAUDE.md がない')
    text = p.read_text(encoding='utf-8')
    if IMPORT_LINE not in text.split():
        defs._backup(p)
        p.write_text(text.rstrip('\n') + SECTION, encoding='utf-8')
    return read(project_dir)


SECTION = f"""

## 性格・話し方

{IMPORT_LINE}

上の性格と話し方は、**あなた自身の返答の言葉づかいにだけ**使う。委任先の結果の事実関係、出典、手順、「守ること」は、性格に関わらず変えない。
"""


# ---- サブオーケストレーターの性格（ADR 0044）----
# 定義ファイルの本文にある「## 性格・話し方」の節（手で書いた「## 性格」の節も同じものとして読む）を、フォームで読み書きする。
# 猫神さまの personality.md と同じ項目（一人称・呼びかけ・口調・性格）と同じ検査を使う。
SUB_SECTION_RE = re.compile(r'^## (?:性格・話し方|性格)[ \t]*\n(.*?)(?=^## |\Z)', re.S | re.M)
SUB_NOTE = '※ この性格と話し方は、自分の返答の言葉づかいにだけ使う。事実関係・出典・手順・守ることは、性格に関わらず変えない。'


def render_section(f):
    return (f"## 性格・話し方\n\n- 一人称: {f['first_person']}\n- 呼びかけ: {f['address']}\n- 口調: {f['tone']}\n\n"
            f"{f['traits']}\n\n{SUB_NOTE}\n")


def read_section(prompt):
    """プロンプトの本文から性格を読む。節がなければ既定値（exists=False）。手で書いた箇条書きの節は、性格の文章としてそのまま読む"""
    m = SUB_SECTION_RE.search(prompt or '')
    if not m:
        return {**DEFAULTS, 'traits': '', 'exists': False}
    body = m[1]
    f = dict(DEFAULTS)
    for k, rx in FIELD_RE.items():
        fm = rx.search(body)
        if fm and fm[1].strip():
            f[k] = fm[1].strip()
    rest = [ln for ln in body.split('\n') if not any(rx.match(ln) for rx in FIELD_RE.values()) and ln.strip() != SUB_NOTE]
    f['traits'] = '\n'.join(rest).strip()
    return {**f, 'exists': True}


def write_section(prompt, data):
    """性格の節を、プロンプトの本文に書き込む（既存の節は置き換え、なければ末尾に足す）。戻り値: 新しい本文"""
    f = {k: _clean(k, data.get(k, DEFAULTS[k])) for k in LIMITS}
    section = render_section(f)
    prompt = prompt or ''
    if SUB_SECTION_RE.search(prompt):
        return SUB_SECTION_RE.sub(lambda _m: section + '\n', prompt, count=1).rstrip('\n') + '\n'
    return prompt.rstrip('\n') + '\n\n' + section
