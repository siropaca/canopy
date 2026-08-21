#!/usr/bin/env python3
"""アプリアイコンの元画像を作る。

出力は 1024x1024 の PNG 1 枚。
ここから `pnpm tauri icon <出力先>` で各サイズと .icns を生成する。

    python3 scripts/gen-icon.py src-tauri/icons/source.png

外部ライブラリを使わない。zlib と struct だけで PNG を書く。
"""

from __future__ import annotations

import math
import struct
import sys
import zlib

SIZE = 1024
# 葉の色。docs/design-system.md の --ahead (#62a85e) を暗くしたもの
BG_TOP = (0x3E, 0x7A, 0x50)
BG_BOTTOM = (0x24, 0x4A, 0x33)
# 幹と枝。--fg
FG = (0xDF, 0xE1, 0xE5)
CORNER = 0.22 * SIZE


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else hi if v > hi else v


def sd_rounded_rect(x: float, y: float, half: float, radius: float) -> float:
    dx = abs(x) - (half - radius)
    dy = abs(y) - (half - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    return outside + min(max(dx, dy), 0.0) - radius


def sd_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length_sq = vx * vx + vy * vy
    t = clamp((wx * vx + wy * vy) / length_sq) if length_sq else 0.0
    return math.hypot(wx - vx * t, wy - vy * t)


def coverage(distance: float) -> float:
    """SDF の値をアンチエイリアス済みの不透明度にする。"""
    return clamp(0.5 - distance)


def branch_distance(x: float, y: float) -> float:
    """幹 1 本 + 枝 2 本 + 節 3 つ。git のブランチを模した形。"""
    trunk = sd_segment(x, y, 0.0, 0.30 * SIZE, 0.0, -0.30 * SIZE)
    upper = sd_segment(x, y, 0.0, -0.02 * SIZE, 0.19 * SIZE, -0.21 * SIZE)
    lower = sd_segment(x, y, 0.0, 0.17 * SIZE, -0.19 * SIZE, -0.02 * SIZE)
    stroke = min(trunk, upper, lower) - 0.035 * SIZE
    nodes = min(
        math.hypot(x - 0.19 * SIZE, y + 0.21 * SIZE),
        math.hypot(x + 0.19 * SIZE, y + 0.02 * SIZE),
        math.hypot(x, y - 0.30 * SIZE),
    ) - 0.075 * SIZE
    return min(stroke, nodes)


def render() -> bytearray:
    half = SIZE / 2
    rows = bytearray()
    for py in range(SIZE):
        rows.append(0)  # PNG のフィルタ種別 (None)
        y = half - (py + 0.5)
        ratio = py / (SIZE - 1)
        base = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * ratio) for i in range(3)
        )
        for px in range(SIZE):
            x = (px + 0.5) - half
            bg_alpha = coverage(sd_rounded_rect(x, y, half, CORNER))
            if bg_alpha <= 0.0:
                rows.extend((0, 0, 0, 0))
                continue
            fg_alpha = coverage(branch_distance(x, y))
            r = round(base[0] + (FG[0] - base[0]) * fg_alpha)
            g = round(base[1] + (FG[1] - base[1]) * fg_alpha)
            b = round(base[2] + (FG[2] - base[2]) * fg_alpha)
            rows.extend((r, g, b, round(bg_alpha * 255)))
    return rows


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_png(path: str, rows: bytearray) -> None:
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", header))
        f.write(chunk(b"IDAT", zlib.compress(bytes(rows), 9)))
        f.write(chunk(b"IEND", b""))


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out = sys.argv[1]
    # 引数を間違えて既存のファイルを PNG で潰さないようにする
    if not out.endswith(".png"):
        print(f"出力先は .png にする: {out}", file=sys.stderr)
        return 2
    write_png(out, render())
    print(f"{out} ({SIZE}x{SIZE})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
