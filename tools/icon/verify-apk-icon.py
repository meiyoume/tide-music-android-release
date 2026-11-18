"""Verify that a built APK really contains the current launcher icons + web assets.

Two things this catches, both of which actually happened:
  - the icon was regenerated but the APK still had the old one (stale build)
  - the UI was edited but assets/tide/* was not re-synced

Resource names are obfuscated by AGP (res/-0.png, res/1h.png ...), so the icons are
identified by size + centre pixel instead of by name.

Usage: python tools/icon/verify-apk-icon.py <path-to.apk>
"""
import hashlib
import io
import sys
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android')
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
UI = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
SIZES = {48: 'mdpi', 72: 'hdpi', 96: 'xhdpi', 144: 'xxhdpi', 192: 'xxxhdpi'}
ASSETS = ['index.html', 'styles.css', 'sfx.js', 'api.js', 'app.js']

apk = Path(sys.argv[1] if len(sys.argv) > 1 else
           ROOT / 'build-staging' / 'lx-music-mobile-v1.9.10-harmony-arm64-v8a.apk')
print(f'APK  {apk.name}  {apk.stat().st_size / 1048576:.2f} MB\n')

ref = Image.open(RES / 'mipmap-xxxhdpi' / 'ic_launcher.png').convert('RGBA')
WANT_CENTER = ref.getpixel((96, 96))
WANT_ALPHA = ref.getpixel((0, 0))[3]
print(f'参照图标：中心 {WANT_CENTER}  角 alpha {WANT_ALPHA}')

problems = []
with zipfile.ZipFile(apk) as z:
    names = z.namelist()
    found = {}
    for n in names:
        if not n.lower().endswith('.png'):
            continue
        try:
            im = Image.open(io.BytesIO(z.read(n))).convert('RGBA')
        except Exception:
            continue
        if im.width != im.height or im.width not in SIZES:
            continue
        c = im.getpixel((im.width // 2, im.height // 2))
        if all(abs(c[i] - WANT_CENTER[i]) <= 6 for i in range(3)) and im.getpixel((0, 0))[3] == WANT_ALPHA:
            found.setdefault(im.width, []).append(n)
    for px, name in sorted(SIZES.items()):
        hits = found.get(px, [])
        print(f'  {name:8} {px:3}px  {len(hits)} 张')
        if not hits:
            problems.append(f'{name} 没有新图标')

    print()
    for a in ASSETS:
        key = f'assets/tide/{a}'
        if key not in names:
            print(f'  {a:12} APK 里没有')
            problems.append(f'assets/tide/{a} 缺失')
            continue
        same = hashlib.sha256(z.read(key)).hexdigest() == \
            hashlib.sha256((UI / a).read_bytes()).hexdigest()
        print(f'  {a:12} {"与源目录一致" if same else "❌ 和源目录不同（忘了同步？）"}')
        if not same:
            problems.append(f'assets/tide/{a} 与源目录不一致')

print()
print('结论：', '可以交付' if not problems else '不能交付：' + '；'.join(problems))
raise SystemExit(1 if problems else 0)
