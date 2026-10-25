#!/usr/bin/env python3
"""走る猫のアニメーション GIF（考え中の表示用）を、標準ライブラリだけで生成する。
使い方: python3 scripts/gen-neko-gif.py  → web/public/neko-run.gif
図柄は本プロジェクトで描いたもの（本体のライセンスに準ずる）。"""
import math
import pathlib
import struct

W, H, SCALE = 64, 40, 2
PAL = [(0, 0, 0), (240, 160, 80), (40, 30, 30), (255, 150, 170), (255, 255, 255)]   # 0=透明, 体, 目/線, 鼻, 白
FRAMES = 6


def draw(i):
    px = [[0] * W for _ in range(H)]

    def put(x, y, c):
        if 0 <= x < W and 0 <= y < H:
            px[y][x] = c

    def ellipse(cx, cy, rx, ry, c):
        for y in range(H):
            for x in range(W):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                    put(x, y, c)

    def line(x0, y0, x1, y1, c, t=1):
        n = max(abs(x1 - x0), abs(y1 - y0), 1) * 2
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n; y = y0 + (y1 - y0) * k / n
            for dx in range(t):
                for dy in range(t):
                    put(round(x) + dx, round(y) + dy, c)

    ph = 2 * math.pi * i / FRAMES
    bob = round(math.sin(ph * 2) * 1.2)
    # 脚（前後で逆位相）
    for base, off in ((38, 0), (34, math.pi), (22, math.pi), (18, 0)):
        s = math.sin(ph + off); lift = max(0, math.cos(ph + off))
        line(base, 24 + bob, base + round(s * 6), 35 - round(lift * 4), 1, 3)
    ellipse(30, 20 + bob, 15, 8, 1)                          # 胴
    # しっぽ（揺れる）
    tx = 10 + round(math.sin(ph) * 2)
    line(16, 19 + bob, tx, 9 + bob, 1, 3); line(tx, 9 + bob, tx + 4, 5 + bob, 1, 3)
    ellipse(47, 15 + bob, 8, 7, 1)                           # 頭
    for ex in (41, 50):                                      # 耳
        for k in range(6):
            line(ex + 1 + (k // 2 if ex == 50 else -(k // 2)), 9 + bob - k, ex + 5 + (k // 2 if ex == 50 else -(k // 2)), 9 + bob - k, 1)
    put(50, 14 + bob, 2); put(51, 14 + bob, 2); put(50, 15 + bob, 2); put(51, 15 + bob, 2)   # 目
    put(55, 17 + bob, 3); put(54, 17 + bob, 3)               # 鼻
    line(53, 18 + bob, 60, 17 + bob, 2); line(53, 19 + bob, 60, 20 + bob, 2)                 # ひげ
    # 速度線
    for k, (yy, ln) in enumerate(((14, 6), (22, 9), (28, 5))):
        x0 = (2 + ((i * 5 + k * 7) % 8)) % 14
        line(x0, yy, x0 + ln, yy, 4)
    return [[c for c in row for _ in range(SCALE)] for row in px for _ in range(SCALE)]


def lzw(data, min_bits):
    clear, end = 1 << min_bits, (1 << min_bits) + 1
    table = {bytes([i]): i for i in range(clear)}
    nxt, bits = end + 1, min_bits + 1
    out, acc, n = bytearray(), 0, 0

    def emit(code):
        nonlocal acc, n
        acc |= code << n; n += bits
        while n >= 8:
            out.append(acc & 255); acc >>= 8; n -= 8

    emit(clear)
    cur = b''
    for b in data:
        nb = cur + bytes([b])
        if nb in table:
            cur = nb; continue
        emit(table[cur])
        if nxt < 4096:
            table[nb] = nxt; nxt += 1
            if nxt - 1 == (1 << bits) and bits < 12:
                bits += 1
        else:
            emit(clear); table = {bytes([i]): i for i in range(clear)}; nxt, bits = end + 1, min_bits + 1
        cur = bytes([b])
    emit(table[cur]); emit(end)
    if n:
        out.append(acc & 255)
    return bytes(out)


def blocks(b):
    return b''.join(bytes([len(b[i:i + 255])]) + b[i:i + 255] for i in range(0, len(b), 255)) + b'\x00'


def gif(frames, delay_cs=8):
    w, h = len(frames[0][0]), len(frames[0])
    pal = PAL + [(0, 0, 0)] * (8 - len(PAL))
    out = b'GIF89a' + struct.pack('<HHBBB', w, h, 0xF2, 0, 0) + b''.join(bytes(c) for c in pal)
    out += b'\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00'            # 無限ループ
    for f in frames:
        out += b'\x21\xF9\x04' + bytes([0x09]) + struct.pack('<H', delay_cs) + b'\x00\x00'   # 透明色 0、背景に戻す
        out += b'\x2C' + struct.pack('<HHHHB', 0, 0, w, h, 0) + b'\x03' + blocks(lzw(bytes(v for row in f for v in row), 3))
    return out + b'\x3B'


if __name__ == '__main__':
    data = gif([draw(i) for i in range(FRAMES)])
    root = pathlib.Path(__file__).resolve().parent.parent
    for d in ('web/public',):
        (root / d).mkdir(parents=True, exist_ok=True)
        (root / d / 'neko-run.gif').write_bytes(data)
    print(f'neko-run.gif {len(data)} bytes, {FRAMES} frames')
