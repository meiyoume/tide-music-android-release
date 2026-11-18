"""Analyse the launch frame sequence to locate the flash.

Prints per-frame mean colour plus a coarse 4-row band breakdown, so a frame that
paints a different background from its neighbours is obvious. Also writes a
downscaled contact sheet for eyeballing.

Usage: python tools/analyse-launch.py [framesDir]
"""
import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
frames_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'shots' / 'launch'
frames = sorted(frames_dir.glob('fl_*.png'))
if not frames:
    raise SystemExit(f'no frames in {frames_dir}')

# Band the frame into rows so we can tell "whole screen white" from "one area white".
ROWS = 4


def analyse(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    small = im.resize((60, 130))
    px = list(small.getdata())
    n = len(px)
    mean = tuple(round(sum(p[i] for p in px) / n) for i in range(3))

    bands = []
    bh = 130 // ROWS
    for r in range(ROWS):
        chunk = px[r * bh:(r + 1) * bh]
        m = tuple(round(sum(p[i] for p in chunk) / len(chunk)) for i in range(3))
        bands.append(m)
    return im, mean, bands


def luma(c):
    return round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])


print(f'{len(frames)} frames in {frames_dir}')
print(f'{"idx":>4} {"mean RGB":>16} {"luma":>5}  {"band lumas (top->bottom)":<26} note')
prev = None
sheet = []
for i, f in enumerate(frames):
    im, mean, bands = analyse(f)
    bl = [luma(b) for b in bands]
    note = ''
    if prev is not None:
        d = abs(luma(mean) - luma(prev))
        if d > 60:
            note = f'<<< JUMP {d}'
    prev = mean
    print(f'{i:>4} {str(mean):>16} {luma(mean):>5}  {str(bl):<26} {note}')
    sheet.append(im.resize((216, 468)))

# Contact sheet: 10 per row
per_row = 10
rows = (len(sheet) + per_row - 1) // per_row
sw, sh = 216, 468
out = Image.new('RGB', (per_row * sw, rows * sh), (20, 20, 20))
for i, im in enumerate(sheet):
    out.paste(im, ((i % per_row) * sw, (i // per_row) * sh))
sheet_path = frames_dir / 'contact-sheet.png'
out.save(sheet_path)
print(f'\ncontact sheet -> {sheet_path}')
