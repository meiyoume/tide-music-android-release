"""给这一轮新做的界面拍预览图（无头 Edge）：播放音效面板 + 搜索联想。

用法: python tools/shots-features.py [宽] [高] [只拍这几个，逗号分隔]
输出: shots/feat-*.png
"""
import os
import subprocess
import sys
from pathlib import Path

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
OUT = ROOT / 'shots'
BASE = 'http://127.0.0.1:8777'

W = int(sys.argv[1]) if len(sys.argv) > 1 else 460
H = int(sys.argv[2]) if len(sys.argv) > 2 else 900

# clicks 用 | 分隔，每步之间等 gap 毫秒
PLAYER_OPEN = '%23listLikes%20[data-token]|%23miniTap'
SET_OPEN = '%5Bdata-push=%22scr-set-playfx%22%5D'
PAGES = {
    # 设置 → 播放音效（整页）
    'set': f'{BASE}/tools/preview.html?push=scr-set-playfx',
    # 播放页 → 音效弹层（默认停在「播放音效」页签）
    'sheet': f'{BASE}/tools/preview.html?clicks={PLAYER_OPEN}|%23pSfx&gap=800',
    # 同一个弹层切到「界面音效」页签（这一步要等弹层动画走完，gap 给大些）
    'ui': f'{BASE}/tools/preview.html?clicks={PLAYER_OPEN}|%23pSfx|[data-sfx-tab=%22ui%22]&gap=1500',
    # 切到「耳机校正」分组（预设最多的那组，看换行）。走设置页：
    # 弹层那条链要四步，无头截图容易在动画中途抓拍
    'auto': f'{BASE}/tools/preview.html?clicks={SET_OPEN}|[data-pf-group=%22autoeq%22]&gap=900',
    # 选一个预设 + 看选中态与摘要
    'picked': f'{BASE}/tools/preview.html?clicks={SET_OPEN}|[data-pf-group=%22vlc%22]|[data-pf-preset=%2214%22]&gap=900',
    # 「更多」弹层里那两行
    'more': f'{BASE}/tools/preview.html?clicks={PLAYER_OPEN}|%23pMore&gap=1500',
    # 设置页偏好那一组（两个入口的摘要）
    'prefs': f'{BASE}/tools/preview.html?clicks=%5Bdata-push=%22scr-settings%22%5D&gap=1500',

    # ── 搜索联想 ──
    # 进搜索页打个字，看联想列表（本地候选立刻出，在线候选随后补）。
    # 预览里用的是演示曲库（中文），所以打「周」才有命中
    'tips': f'{BASE}/tools/preview.html?clicks=%5Bdata-push=%22scr-search%22%5D&type=%E5%91%A8&gap=1200',
    # 打一个只在热搜里有的词，看本地兜底（演示曲库里没有 lofi）
    'tips-hot': f'{BASE}/tools/preview.html?clicks=%5Bdata-push=%22scr-search%22%5D&type=lofi&gap=1200',
    # 点第一行「搜索原文」之后：联想收起、结果出来。要先打字再点，所以 typefirst
    'tips-go': f'{BASE}/tools/preview.html?clicks=%5Bdata-push=%22scr-search%22%5D|%5Bdata-tip-go%5D'
               f'&type=%E5%91%A8&typefirst=1&gap=1500',
}

OUT.mkdir(exist_ok=True)
profile = Path(os.environ['TEMP']) / 'edgeprof'
profile.mkdir(exist_ok=True)

only = sys.argv[3].split(',') if len(sys.argv) > 3 else None

for name, url in PAGES.items():
    if only and name not in only:
        continue
    dest = OUT / f'feat-{name}.png'
    if dest.exists():
        dest.unlink()
    cmd = [
        EDGE,
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        f'--user-data-dir={profile}',
        '--virtual-time-budget=20000',
        f'--window-size={W},{H}',
        f'--screenshot={dest}',
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if dest.exists():
        print(f'{name:8} -> {dest.name}  {dest.stat().st_size // 1024} KB')
    else:
        print(f'{name:8} -> FAILED')
        print((proc.stderr or '')[-600:])
