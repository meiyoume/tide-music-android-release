"""临时排查：沿一条水平线扫过去，把最饱和的那个像素打出来（找开关的轨道色）。"""
import colorsys
import sys
from PIL import Image

path = sys.argv[1]
y = int(sys.argv[2])
x1, x2 = int(sys.argv[3]), int(sys.argv[4])
im = Image.open(path).convert('RGB')
best = None
for x in range(x1, x2):
    r, g, b = im.getpixel((x, y))
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if best is None or s > best[0]:
        best = (s, x, r, g, b)
s, x, r, g, b = best
print('y=%d 最饱和：x=%d  #%02X%02X%02X  (饱和 %.2f)' % (y, x, r, g, b, s))
print('参考：Tide 薄荷 #3ECFB2 / 鸿蒙绿 #31C27C / 洛雪红 #4DAF7C')
