"""Crop + upscale a region of a screenshot so small details are readable.

Usage: python tools/crop.py <src> <out> <x> <y> <w> <h> [zoom]
"""
import sys

from PIL import Image

src, out = sys.argv[1], sys.argv[2]
x, y, w, h = (int(v) for v in sys.argv[3:7])
zoom = int(sys.argv[7]) if len(sys.argv) > 7 else 3
im = Image.open(src).crop((x, y, x + w, y + h)).resize((w * zoom, h * zoom), Image.LANCZOS)
im.save(out)
print(out, im.size)
