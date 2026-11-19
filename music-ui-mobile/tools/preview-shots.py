"""Render preview pages with headless Edge.

Wraps the msedge CLI so the invocation (and its noisy stderr) is in one place.

Usage: python tools/preview-shots.py
"""
import os
import subprocess
import sys
from pathlib import Path

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
OUT = ROOT / 'shots'
BASE = 'http://127.0.0.1:8777'

PAGES = {
    'home': f'{BASE}/index.html',
    'fav': f'{BASE}/tools/preview.html?tab=fav',
    'search': f'{BASE}/tools/preview.html?push=scr-search',
    'library': f'{BASE}/tools/preview.html?tab=library',
}

WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 460
HEIGHT = int(sys.argv[2]) if len(sys.argv) > 2 else 900

OUT.mkdir(exist_ok=True)
profile = Path(os.environ['TEMP']) / 'edgeprof'
profile.mkdir(exist_ok=True)

for name, url in PAGES.items():
    dest = OUT / f'pv-{name}.png'
    cmd = [
        EDGE,
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        f'--user-data-dir={profile}',
        '--virtual-time-budget=9000',
        f'--window-size={WIDTH},{HEIGHT}',
        f'--screenshot={dest}',
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if dest.exists():
        print(f'{name:8} -> {dest.name}  {dest.stat().st_size // 1024} KB')
    else:
        print(f'{name:8} -> FAILED')
        print((proc.stderr or '')[-500:])
