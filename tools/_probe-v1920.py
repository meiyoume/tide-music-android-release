"""v1.9.20 的现场勘查：原生设置的新版式 + 新的「添加音源」页长什么样。

用户两次反馈「原生设置还是没有变化 / 音源点进去三级菜单还是很割裂」，
这一轮把设置树整体换成潮汐界面的骨架、并把「添加音源」自己画了一页。
这里先拍下来看，并 dump 一下「添加音源」页的节点（要看那个地址输入框
在 uiautomator 里是什么样子，验收脚本要按它点）。
"""
import re
import subprocess
import time
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\probe20_ui.xml')


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/probe20_ui.xml')
    adb('pull', '/sdcard/probe20_ui.xml', str(DUMP))
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
        d = re.search(r'content-desc="([^"]*)"', tag)
        c = re.search(r'clickable="(\w+)"', tag)
        cls = re.search(r'class="([^"]*)"', tag)
        out.append({'text': (t.group(1) if t else '') or (d.group(1) if d else ''),
                    'class': cls.group(1) if cls else '',
                    'clickable': c.group(1) == 'true' if c else False,
                    'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2,
                    'w': x2 - x1, 'h': y2 - y1,
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
shot('y20-01-mine')

# 洛雪原生设置（新版式）
n = find(r'洛雪原生设置')
if n:
    tap(n, 4)
    shot('y20-02-native-settings')
    rows = [x for x in nodes() if x['clickable'] and x['w'] > 500]
    print('    设置页里宽行的数量 %d，高度分布 %s'
          % (len(rows), sorted({r['h'] for r in rows})))
    adb('shell', 'input', 'swipe', '540', '1700', '540', '700', '300')
    time.sleep(1.5)
    shot('y20-02b-native-settings-scroll')
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(2)
else:
    print('    找不到「洛雪原生设置」')

# 音源页 → 添加音源（新的一页）
if tap_text(r'音源切换', 3.5):
    shot('y20-03-source')
    if tap_text(r'添加音源', 4):
        time.sleep(1.5)
        shot('y20-04-source-add')
        print('    ---- 添加音源页的节点 ----')
        for x in nodes():
            if x['text'] or x['clickable']:
                print('    %-28s %-26s %s  %s' %
                      (x['text'][:28], x['class'].split('.')[-1][:26],
                       'click' if x['clickable'] else '     ',
                       '%dx%d @%d,%d' % (x['w'], x['h'], x['x'], x['y'])))
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)
