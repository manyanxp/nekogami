#!/usr/bin/env python3
"""猫神さまのアイコン（icons/cat-goddess-icons/sun_cat_goddess.png、1254px）を、アバター用の小さな PNG にする。標準ライブラリだけ。
使い方: python3 scripts/make-avatar.py [サイズ=192]
出力: web/public/neko-goddess.png（透明背景のまま）と、ポータルのアイコン選択用の portal/assets/icons/<名前>.png（ADR 0032）"""
import pathlib
import struct
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / 'icons' / 'cat-goddess-icons'
SRC = SRC_DIR / 'sun_cat_goddess.png'
CHOICES = ('miko_cat_goddess', 'sun_cat_goddess', 'munakata_tagorihime', 'munakata_ichikishimahime', 'munakata_tagitsuhime')


def read_png(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, ihdr = 8, b'', None
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if typ == b'IHDR': ihdr = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT': idat += body
        pos += 12 + n
    w, h, depth, ctype, _, _, interlace = ihdr
    assert (depth, ctype, interlace) == (8, 6, 0), 'RGBA 8bit・非インターレースの PNG のみ対応'
    raw, bpp, stride = zlib.decompress(idat), 4, w * 4
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, rows


def shrink(w, h, rows, size):
    """面積平均（アルファで重み付け）で size×size にする"""
    out = []
    for oy in range(size):
        y0, y1 = oy * h / size, (oy + 1) * h / size
        line = bytearray()
        for ox in range(size):
            x0, x1 = ox * w / size, (ox + 1) * w / size
            r = g = b = a = tw = 0.0
            for y in range(int(y0), min(h, int(y1) + 1)):
                wy = min(y + 1, y1) - max(y, y0)
                if wy <= 0: continue
                row = rows[y]
                for x in range(int(x0), min(w, int(x1) + 1)):
                    wx = min(x + 1, x1) - max(x, x0)
                    if wx <= 0: continue
                    k = wx * wy; al = row[x * 4 + 3] / 255
                    r += row[x * 4] * al * k; g += row[x * 4 + 1] * al * k; b += row[x * 4 + 2] * al * k; a += al * k; tw += k
            line += bytes([round(r / a) if a else 0, round(g / a) if a else 0, round(b / a) if a else 0, round(255 * a / tw)])
        out.append(line)
    return out


def write_png(path, size, rows):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 192
    w, h, rows = read_png(SRC)
    write_png(ROOT / 'web' / 'public' / 'neko-goddess.png', size, shrink(w, h, rows, size))
    print(f'neko-goddess.png {size}x{size}')
    for name in CHOICES:
        w, h, rows = read_png(SRC_DIR / f'{name}.png')
        write_png(ROOT / 'portal' / 'assets' / 'icons' / f'{name}.png', size, shrink(w, h, rows, size))
        print(f'portal/assets/icons/{name}.png {size}x{size}')
