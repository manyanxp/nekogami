"""エージェントのアイコン（ADR 0032）。組み込み（portal/assets/icons/）と、アップロード（portal/data/icons/）。
台帳の `icon` は参照文字列（`builtin:<名前>` / `upload:<ID>`）。None は既定（種別ごと）。
アップロードは中身を見て種類を決め（SVG は不可。スクリプトを含められるため）、内容のハッシュを名前にして保存する。"""
import hashlib
import os
import re
import struct
import tempfile
from pathlib import Path

MAX_UPLOAD = 512 * 1024
MAX_UPLOADS = 100
MAX_PIXELS = 4096
REF_RE = re.compile(r'^(builtin|upload):([a-z0-9][a-z0-9_]{0,63}(?:\.[a-z]{3,4})?)$')
TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif'}
DEFAULTS = {'orchestrator': 'builtin:sun_cat_goddess'}
DEFAULT_OTHER = 'builtin:miko_cat_goddess'


class IconError(ValueError):
    pass


def default_for(kind):
    return DEFAULTS.get(kind, DEFAULT_OTHER)


def sniff(data):
    """先頭のバイト列から画像の種類を返す（拡張子 / Content-Type は信用しない）。不明なら None"""
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    return None


def _size(kind, data):
    """幅・高さ（PNG / GIF だけ。ほかは None）"""
    if kind == 'png' and data[12:16] == b'IHDR':
        return struct.unpack('>II', data[16:24])
    if kind == 'gif':
        return struct.unpack('<HH', data[6:10])
    return None


class IconStore:
    def __init__(self, builtin_dir, upload_dir):
        self.builtin_dir, self.upload_dir = Path(builtin_dir), Path(upload_dir)

    # ---- 一覧・参照 ----
    def builtin_names(self):
        return sorted(p.stem for p in self.builtin_dir.glob('*.png') if REF_RE.match(f'builtin:{p.stem}')) if self.builtin_dir.is_dir() else []

    def upload_ids(self):
        if not self.upload_dir.is_dir():
            return []
        return sorted((p.name for p in self.upload_dir.iterdir() if p.is_file() and REF_RE.match(f'upload:{p.name}')),
                      key=lambda n: -(self.upload_dir / n).stat().st_mtime)

    def listing(self):
        return {'builtin': [f'builtin:{n}' for n in self.builtin_names()], 'uploads': [f'upload:{i}' for i in self.upload_ids()],
                'defaults': {'orchestrator': default_for('orchestrator'), 'other': DEFAULT_OTHER}}

    def path(self, ref):
        """参照から、保存先のファイルを返す。形式が不正・ファイルが無いときは None（パスは組み立てるだけで、入力をそのまま使わない）"""
        m = REF_RE.match(ref or '')
        if not m:
            return None
        base = self.builtin_dir / f'{m.group(2)}.png' if m.group(1) == 'builtin' else self.upload_dir / m.group(2)
        return base if base.is_file() and base.parent.resolve() in (self.builtin_dir.resolve(), self.upload_dir.resolve()) else None

    def media_type(self, ref):
        p = self.path(ref)
        return TYPES.get(p.suffix.lstrip('.') if ref.startswith('upload:') else 'png') if p else None

    def exists(self, ref):
        return self.path(ref) is not None

    def clean_ref(self, ref):
        """台帳の icon の検証。None / 空は既定"""
        if ref in (None, ''):
            return None
        if not isinstance(ref, str) or not self.exists(ref):
            raise IconError('icon は、一覧にある参照（builtin:… / upload:…）か null')
        return ref

    # ---- アップロード ----
    def add(self, data):
        if not data:
            raise IconError('画像が空')
        if len(data) > MAX_UPLOAD:
            raise IconError(f'画像は {MAX_UPLOAD // 1024}KB まで')
        kind = sniff(data)
        if kind is None:
            raise IconError('PNG / JPEG / WebP / GIF のみ（SVG は不可）')
        size = _size(kind, data)
        if size and not (0 < size[0] <= MAX_PIXELS and 0 < size[1] <= MAX_PIXELS):
            raise IconError(f'画像は {MAX_PIXELS}px 四方まで')
        name = f'{hashlib.sha256(data).hexdigest()[:16]}.{kind}'
        target = self.upload_dir / name
        if not target.exists():
            if len(self.upload_ids()) >= MAX_UPLOADS:
                raise IconError(f'アップロードは {MAX_UPLOADS} 枚まで。使っていないものを削除する')
            self.upload_dir.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.upload_dir, suffix='.tmp')
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
            os.replace(tmp, target)
        return f'upload:{name}'

    def remove(self, ref):
        m = REF_RE.match(ref or '')
        if not m or m.group(1) != 'upload':
            raise IconError('削除できるのはアップロードしたアイコンだけ')
        p = self.path(ref)
        if p is None:
            raise IconError('アイコンが見つからない')
        p.unlink()
