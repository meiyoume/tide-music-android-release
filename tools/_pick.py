"""临时排查：从截图里采几个点的颜色，判断原生页到底用的是哪套色。

判据：Tide 默认皮肤的主题色是薄荷 `#3ECFB2`，而鸿蒙 token 里那个绿是 `#31C27C`。
两者很接近（都是绿），所以「改没改」肉眼分不出来 —— 只能采像素。
"""
import sys
from PIL import Image

path = sys.argv[1]
pts = [(int(a), int(b)) for a, b in (p.split(',') for p in sys.argv[2:])]
im = Image.open(path).convert('RGB')
print('图片尺寸', im.size)
for x, y in pts:
    # 采 5x5 的中心值，避开抗锯齿边
    px = [im.getpixel((x + dx, y + dy)) for dx in range(-2, 3) for dy in range(-2, 3)]
    r = sum(p[0] for p in px) // len(px)
    g = sum(p[1] for p in px) // len(px)
    b = sum(p[2] for p in px) // len(px)
    print('  (%4d,%4d)  #%02X%02X%02X' % (x, y, r, g, b))
