"""Capture every main screen at a real phone width (411x914 CSS px).

Headless Edge clamps the window to ~500px wide, so the preview driver pins the
iframe to 411x914 and the outer window stays 500x960 (black margins).
Writes shots/v2-*.png
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

DARK = len(sys.argv) > 1 and sys.argv[1] == 'dark'
PREFIX = 'v2d-' if DARK else 'v2-'

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
OUT = ROOT / 'shots'
BASE = 'http://127.0.0.1:8777/tools/preview.html?w=411&h=914&noboot=1'

ROW = '#listLikes [data-token]'
LIB = '[data-tab-go="library"]'

# name -> (query, clicks, gap, extra)
STATES = {
    'v2-home': ('', [], 0, 800),
    'v2-charts': ('tab=charts', [], 0, 900),
    'v2-search': ('push=scr-search', [], 0, 700),
    'v2-search-tips': ('push=scr-search&type=zhou', [], 0, 900),
    'v2-fav': ('tab=fav', [], 0, 900),
    'v2-library': ('tab=library', [], 0, 900),
    'v2-source': ('', [LIB, '[data-push="scr-source"]'], 700, 1100),
    'v2-source-add': ('', [LIB, '[data-push="scr-source-add"]'], 700, 1100),
    'v2-theme': ('', [LIB, '[data-push="scr-set-theme"]'], 700, 1100),
    'v2-sfx-settings': ('', [LIB, '[data-push="scr-set-sfx"]'], 700, 1100),
    'v2-player': ('', [ROW, '#miniTap'], 900, 1500),
    'v2-lyrics': ('', [ROW, '#miniTap', '#pArt'], 900, 2000),
    'v2-sheet-sfx': ('', [ROW, '#miniTap', '#pSfx'], 900, 1500),
    'v2-sheet-more': ('', [ROW, '#miniTap', '#pMore'], 900, 1500),
    'v2-playlist': ('', ['#homePlaylists [data-playlist]'], 900, 1200),
    'v2-daily': ('', ['.dailypick'], 900, 1200),
    'v2-square': ('', ['[data-push="scr-square"]'], 900, 1000),
    'v2-about': ('', [LIB, '[data-push="scr-set-about"]'], 700, 1000),
}

OUT.mkdir(exist_ok=True)
profile = Path(os.environ['TEMP']) / ('edgeprof-v2d' if DARK else 'edgeprof-v2')
profile.mkdir(exist_ok=True)

for name, (query, clicks, gap, extra) in STATES.items():
    url = BASE + (('&' + query) if query else '')
    if clicks:
        url += '&clicks=' + quote('|'.join(clicks), safe='')
        url += f'&gap={gap}&delay=1500'
    budget = 1600 + gap * len(clicks) + extra
    dest = OUT / f'{PREFIX}{name[3:]}.png'
    cmd = [
        EDGE,
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--autoplay-policy=no-user-gesture-required',
        f'--user-data-dir={profile}',
        f'--virtual-time-budget={budget}',
        '--window-size=500,960',
        f'--screenshot={dest}',
        url,
    ]
    if DARK:
        cmd.insert(-2, '--force-dark-mode')
    r = subprocess.run(cmd, capture_output=True)
    size = dest.stat().st_size if dest.exists() else 0
    print(f'{PREFIX + name[3:]:18} {"ok" if size else "FAILED"} {size // 1024} KB')
