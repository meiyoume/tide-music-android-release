"""把冷启动期间内核发出的所有网络请求按 URL 归类计数（看有没有请求风暴）。"""
import re
import subprocess
import sys
import time
from collections import Counter

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'

subprocess.run([ADB, 'shell', 'am', 'force-stop', PKG], capture_output=True)
time.sleep(2)
subprocess.run([ADB, 'logcat', '-c'], capture_output=True)
subprocess.run([ADB, 'shell', 'am', 'start', '-n', ACT], capture_output=True)
time.sleep(int(sys.argv[1]) if len(sys.argv) > 1 else 16)

log = subprocess.run([ADB, 'logcat', '-d', '-v', 'time'],
                     capture_output=True).stdout.decode('utf-8', 'replace')

t0 = None
rows = []
for line in log.splitlines():
    m = re.match(r'\d\d-\d\d (\d\d:\d\d:\d\d\.\d+)', line)
    if not m:
        continue
    if 'Displayed ' in line and t0 is None:
        t0 = m.group(1)
    s = re.search(r"---start---', '([^']+)'", line)
    if s:
        rows.append((m.group(1), s.group(1)))

if t0:
    print('Displayed 在 %s，下面时间都相对它' % t0)

def rel(t):
    a = sum(float(x) * f for x, f in zip(t.split(':'), (3600, 60, 1)))
    b = sum(float(x) * f for x, f in zip(t0.split(':'), (3600, 60, 1)))
    return a - b

def kind(u):
    u = re.sub(r'[?&](reqId|loginUid|loginSid|appUid|pn|rn)=[^&]*', '', u)
    return re.sub(r'(data|sign|token)=[^&]*', r'\1=...', u)[:110]

print('\n共 %d 个请求' % len(rows))
for u, n in Counter(kind(u) for _, u in rows).most_common(12):
    print('  %3d 次  %s' % (n, u))

print('\n按时间分布（每 0.5 秒一格）：')
buckets = Counter()
for t, _ in rows:
    buckets[round(rel(t) * 2) / 2] += 1
for k in sorted(buckets):
    if k >= -1:
        print('  +%5.1fs  %s' % (k, '#' * min(buckets[k], 60)))
