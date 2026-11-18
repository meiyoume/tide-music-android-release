"""拍几张原生子页面的现状：我的 → 洛雪原生设置，以及 音源 → 添加音源（三级）。

目的：用户说「原生设置还是没有变化」「音源点进去三级菜单还是很割裂」——
先看清楚现在长什么样，再决定是改配色还是改版式。
"""
import re
import subprocess
import time
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\probe_ui.xml')


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/probe_ui.xml')
    adb('pull', '/sdcard/probe_ui.xml', str(DUMP))
    text = DUMP.read_text(encoding='utf-8', errors='replace')
    out = []
    for m in re.finditer(r'<node[^>]*>', text):
        tag = m.group(0)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not b:
            continue
        x1, y1, x2, y2 = (int(g) for g in b.groups())
        if x2 == 0 and y2 == 0:
            continue
        t = re.search(r'text="([^"]*)"', tag)
        out.append({'text': t.group(1) if t else '',
                    'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2,
                    'bounds': (x1, y1, x2, y2)})
    return out


def find(pat, want=0):
    hits = [n for n in nodes() if re.search(pat, n['text'])]
    return hits[want] if len(hits) > want else None


def tap(n, wait=2.5):
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)


def shot(name):
    SHOTS.mkdir(exist_ok=True)
    (SHOTS / ('dev-%s.png' % name)).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    print('    shot -> dev-%s.png' % name)


def tap_text(pat, wait=2.5, want=0):
    n = find(pat, want)
    if not n:
        print('    找不到「%s」' % pat)
        return False
    tap(n, wait)
    return True


adb('shell', 'am', 'force-stop', PKG)
time.sleep(1)
adb('shell', 'am', 'start', '-n', ACT)
time.sleep(24)
for _ in range(6):
    if 'harmony' in adb('shell', 'dumpsys', 'window'):
        break
    time.sleep(3)

# 我的
for i in range(4):
    n = find(r'^我的$')
    if n:
        tap(n, 2.5)
        break
    time.sleep(1)
shot('zz-01-mine')

# 洛雪原生设置
n = find(r'洛雪原生设置')
if n:
    tap(n, 4)
    shot('zz-02-native-settings')
    # 往下滚两屏，看分组卡片的样子
    for k in range(2):
        adb('shell', 'input', 'swipe', '540', '1700', '540', '700', '300')
        time.sleep(1.5)
        shot('zz-02b-native-settings-scroll%d' % (k + 1))
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(2)
else:
    print('    找不到「洛雪原生设置」')

# 音源页 → 添加音源（三级）
if tap_text(r'音源切换', 3.5):
    shot('zz-03-source')
    if tap_text(r'添加音源', 4):
        time.sleep(2)
        shot('zz-04-source-import')
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)
