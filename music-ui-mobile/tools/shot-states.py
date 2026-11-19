"""Screenshot the states that need a few taps to reach (headless Edge).

Usage: python tools/shot-states.py
Writes shots/st-*.png
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
OUT = ROOT / 'shots'
BASE = 'http://127.0.0.1:8777/tools/preview.html'
WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 460
HEIGHT = int(sys.argv[2]) if len(sys.argv) > 2 else 900

ROW = '#listLikes [data-token]'

# name -> (clicks, gap, 额外等待毫秒)
STATES = {
    'st-player': ([ROW, '#miniTap'], 700, 1200),
    'st-sfxsheet': ([ROW, '#miniTap', '#pSfx'], 700, 1400),
    'st-sfxwood': ([ROW, '#miniTap', '#pSfx', '#sfxSheet [data-sfx-pack="wood"]'], 600, 1400),
    'st-moresheet': ([ROW, '#miniTap', '#pMore'], 900, 3200),
    'st-sort-name': (['#homePlaylists [data-playlist]', '#plSort'], 900, 1400),
    'st-account': (['[data-tab-go="library"]', '[data-push="scr-settings"]',
                    '[data-push="scr-set-account"]'], 700, 1400),
    'st-library': (['[data-tab-go="library"]'], 700, 1200),
    'st-fav': (['[data-tab-go="fav"]'], 700, 1200),
}

OUT.mkdir(exist_ok=True)
profile = Path(os.environ['TEMP']) / 'edgeprof-states'
profile.mkdir(exist_ok=True)

for name, (clicks, gap, extra) in STATES.items():
    url = (f'{BASE}?clicks={quote("|".join(clicks), safe="")}'
           f'&gap={gap}&delay=1500')
    dest = OUT / f'{name}.png'
    cmd = [
        EDGE,
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        f'--user-data-dir={profile}',
        f'--virtual-time-budget={1500 + gap * len(clicks) + extra}',
        f'--window-size={WIDTH},{HEIGHT}',
        f'--screenshot={dest}',
        url,
    ]
    r = subprocess.run(cmd, capture_output=True)
    size = dest.stat().st_size if dest.exists() else 0
    print(f'{name:16} {"ok" if size else "FAILED"} {size} bytes  {url}')
