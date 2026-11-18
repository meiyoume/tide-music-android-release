"""Render the Tide icon into every Android launcher-icon resource.

Why a script instead of a one-off: the launcher icon lives in 12 files
(5 densities x square/round) plus two vector drawables for the adaptive icon,
and they have to stay in sync. Change tools/icon/tide-icon.svg, run this,
and the whole set is regenerated.

Renders the SVG with headless Edge (Pillow can't do SVG), then downscales with
Pillow. Round variants get a circle mask so the corners are really transparent.

Usage: python tools/icon/make-android-icons.py
"""
import os
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from PIL import Image

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(__file__).resolve().parent
APP_RES = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android\android\app\src\main\res')
BIG = 1024
DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def render(svg_name, dest: Path, size: int) -> None:
    """Screenshot tools/icon/<svg_name> at `size` px through the driver page."""
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    port = server.server_address[1]
    import threading
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = (f'http://127.0.0.1:{port}/icon-render.html'
               f'?svg={quote(svg_name)}&size={size}')
        profile = Path(os.environ['TEMP']) / 'edgeprof-icon'
        profile.mkdir(exist_ok=True)
        subprocess.run(
            [EDGE, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
             '--default-background-color=00000000',
             f'--user-data-dir={profile}',
             f'--window-size={size + 8},{size + 8}',
             f'--screenshot={dest}', url],
            capture_output=True, timeout=120,
        )
    finally:
        server.shutdown()
    if not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f'渲染失败：{svg_name} @{size}')
    im = Image.open(dest).convert('RGBA')
    if im.width < size or im.height < size:
        raise RuntimeError(f'截图比目标小：{im.size} < {size}')
    return im.crop((0, 0, size, size))


def circle(im: Image.Image) -> Image.Image:
    """把方图裁成圆，四角真的透明（不是画一个白圆上去）。"""
    from PIL import ImageDraw
    size = im.width
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = im.copy()
    out.putalpha(mask)
    return out


def main():
    print(f'渲染 {BIG}px 大图（无头 Edge）…')
    tmp = ROOT / '_big-square.png'
    tmp_r = ROOT / '_big-round.png'
    square = render('tide-icon.svg', tmp, BIG)
    round_ = render('tide-icon-round.svg', tmp_r, BIG)

    # 先存一张大图当参照，方便肉眼比对（不进 APK）
    square.resize((512, 512), Image.LANCZOS).save(ROOT / 'tide-icon-preview.png')
    round_.resize((512, 512), Image.LANCZOS).save(ROOT / 'tide-icon-preview-round.png')

    for name, px in DENSITIES.items():
        out_dir = APP_RES / f'mipmap-{name}'
        out_dir.mkdir(parents=True, exist_ok=True)
        square.resize((px, px), Image.LANCZOS).save(out_dir / 'ic_launcher.png')
        circle(round_.resize((px, px), Image.LANCZOS)).save(out_dir / 'ic_launcher_round.png')
        print(f'  mipmap-{name:8} ic_launcher.png / ic_launcher_round.png  {px}x{px}')

    tmp.unlink(missing_ok=True)
    tmp_r.unlink(missing_ok=True)
    print('\n矢量（自适应图标，Android 8+）请同步改：')
    print('  res/drawable/ic_launcher_foreground.xml   （音符 + 浪，落在中间 64dp 安全区里）')
    print('  res/drawable/ic_launcher_bg.xml           （青蓝渐变铺满 108dp）')
    print('  res/mipmap-anydpi-v26/ic_launcher{,_round}.xml 指向上面两个')


if __name__ == '__main__':
    sys.exit(main())
