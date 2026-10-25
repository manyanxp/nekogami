"""ポータルと Agent Console のテーマ（ADR 0024）。管理ページで変更し、portal/data/theme.json に保存する。
Agent Console は同じファイルを読む（dashboard/theme.mjs）。値は検証してから保存・配信する。"""
import json
import os
import re
import tempfile
from pathlib import Path

MODES = ('auto', 'dark', 'light')
HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
DEFAULT = {'mode': 'auto', 'accent': None, 'preset': 'default'}
PRESET_RE = re.compile(r'^[a-z0-9-]{1,24}$')


class ThemeError(ValueError):
    pass


def clean(data):
    if not isinstance(data, dict):
        raise ThemeError('テーマはオブジェクト')
    mode = data.get('mode', 'auto')
    if mode not in MODES:
        raise ThemeError(f"mode は {MODES} のいずれか")
    accent = data.get('accent')
    if accent is not None and not (isinstance(accent, str) and HEX_RE.match(accent)):
        raise ThemeError('accent は #rrggbb の形式（または null で既定）')
    preset = data.get('preset', 'default')
    if not (isinstance(preset, str) and PRESET_RE.match(preset)):
        raise ThemeError('preset の形式が不正')
    return {'mode': mode, 'accent': accent.lower() if accent else None, 'preset': preset}


def read(path):
    try:
        return clean(json.loads(Path(path).read_text(encoding='utf-8')))
    except (OSError, ValueError):       # 無い・壊れているときは既定
        return dict(DEFAULT)


def write(path, data):
    t = clean(data)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent, suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(t, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    return t
