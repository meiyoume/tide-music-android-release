"""把自适应图标的模拟图渲染出来，并叠几种启动器蒙版，看标记有没有落在安全区里。

Usage: python tools/icon/preview-adaptive.py
"""
import os
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'adaptive-preview.png'
PX = 432  # 108dp 的 4 倍


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
raw = ROOT / '_adaptive-raw.png'
url = (f'http://127.0.0.1:{srv.server_address[1]}/icon-render.html'
       f'?svg={quote("_adaptive-preview.svg")}&size={PX}')
subprocess.run(
    [EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
     '--default-background-color=00000000',
     f'--user-data-dir={os.path.join(os.environ["TEMP"], "edgeprof-icon")}',
     f'--window-size={PX + 8},{PX + 8}', f'--screenshot={raw}', url],
    capture_output=True, timeout=120)
srv.shutdown()

im = Image.open(raw).convert('RGBA').crop((0, 0, PX, PX))
safe_r = 33 / 108 * PX      # 安全区半径
mask_r = 36 / 108 * PX      # 常见圆形蒙版半径（比安全区稍大）


def masked(shape):
    m = Image.new('L', (PX * 2, PX * 2), 0)
    d = ImageDraw.Draw(m)
    box = (0, 0, PX * 2 - 1, PX * 2 - 1)
    if shape == 'circle':
        d.ellipse(box, fill=255)
    elif shape == 'squircle':
        d.rounded_rectangle(box, radius=int(PX * 2 * 0.28), fill=255)
    else:
        d.rectangle(box, fill=255)
    m = m.resize((PX, PX), Image.LANCZOS)
    out = Image.new('RGBA', (PX, PX), (10, 11, 15, 255))
    out.paste(im, (0, 0), m)
    return out


panels = [('原始 108dp（红圈=安全区）', im),
          ('圆形蒙版', masked('circle')),
          ('圆角蒙版', masked('squircle')),
          ('方形蒙版', masked('rect'))]

W, H = PX * 2, PX * 2
sheet = Image.new('RGBA', (W, H), (10, 11, 15, 255))
for i, (_, p) in enumerate(panels):
    sheet.paste(p, ((i % 2) * PX, (i // 2) * PX))
sheet.resize((W // 2, H // 2), Image.LANCZOS).save(OUT)
raw.unlink(missing_ok=True)
print(OUT)
