"""Find where a colour sits in a screenshot, so taps can use real pixels.

Estimating tap coordinates from a scaled screenshot was off by ~60px, which cost
several wrong taps (the settings row below the one I aimed at opened instead).
This measures the actual pixel bands of a colour in a given x range.

Usage:
  python tools/find-color.py shots/live/x.png 62,207,178 880 1030
    -> prints the y bands where the accent colour appears between x 880..1030

Coordinates are in the image's own pixel space, which is what `adb shell input tap`
expects.
"""
import sys
from pathlib import Path

from PIL import Image

img = Path(sys.argv[1])
rgb = tuple(int(v) for v in sys.argv[2].split(','))
x0 = int(sys.argv[3]) if len(sys.argv) > 3 else 0
x1 = int(sys.argv[4]) if len(sys.argv) > 4 else 10 ** 6
tol = int(sys.argv[5]) if len(sys.argv) > 5 else 26

im = Image.open(img).convert('RGB')
w, h = im.size
px = im.load()
print(f'image {w}x{h}  colour {rgb}  x {x0}..{x1}  tol {tol}')

bands = []
run = None
for y in range(h):
    n = 0
    for x in range(max(0, x0), min(w, x1)):
        r, g, b = px[x, y]
        if abs(r - rgb[0]) <= tol and abs(g - rgb[1]) <= tol and abs(b - rgb[2]) <= tol:
            n += 1
    if n > 4:
        if run is None:
            run = [y, y]
        else:
            run[1] = y
    elif run is not None:
        bands.append(tuple(run))
        run = None
if run is not None:
    bands.append(tuple(run))

if not bands:
    print('no match')
for a, b in bands:
    print(f'  y {a}..{b}   centre {(a + b) // 2}')
