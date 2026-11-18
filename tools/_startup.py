"""Cold-start timeline for the tide shell, relative to process start.

Writes one row per cold start so before/after builds can be compared directly.

  python tools/_startup.py 3
"""
import re
import subprocess
import sys
import time

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'

# Only ASCII in this file: the console here is GBK.
PATTERNS = [
    ('proc', re.compile(r'Start proc \d+:cn\.tos')),
    ('jsstart', re.compile(r'starting app\.\.\.')),
    ('displayed', re.compile(r'Displayed cn\.toside.*?\+(\d+)ms')),
    ('homescreen', re.compile(r'Running "lxm\.HomeScreen')),
    ('prewarm', re.compile(r'TidePrewarm.*prewarm created')),
    ('renderer', re.compile(r'Start proc \d+:com\.google\.android\.webview')),
    ('loadstart', re.compile(r'\[TideWeb\] loadStart')),
    ('appjs', re.compile(r'\[TideWeb\] t\+(\d+)ms app\.js start')),
    ('initok', re.compile(r'\[TideWeb\] t\+(\d+)ms init ok')),
    ('paint', re.compile(r'\[TideWeb\] t\+(\d+)ms first paint')),
    ('home', re.compile(r'\[TideWeb\] t\+(\d+)ms home')),
]


def adb(*a, timeout=120):
    return subprocess.run([ADB, *a], capture_output=True, timeout=timeout)\
        .stdout.decode('utf-8', 'replace')


def ts(line):
    m = re.match(r'\d\d-\d\d (\d\d):(\d\d):(\d\d)\.(\d+)', line)
    if not m:
        return None
    h, mi, s, ms = m.groups()
    return (int(h) * 3600 + int(mi) * 60 + int(s)) * 1000 + int(ms.ljust(3, '0')[:3])


def one(idx):
    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(2.5)
    adb('logcat', '-c')
    out = adb('shell', 'am', 'start', '-W', '-n', ACT)
    tt = ''
    for line in out.splitlines():
        if 'TotalTime' in line:
            tt = line.split(':')[-1].strip()
    time.sleep(10)

    log = adb('logcat', '-d', '-v', 'time')
    hits = {}
    payload = {}
    navline = ''
    for line in log.splitlines():
        if 'nav responseEnd' in line and not navline:
            navline = line.strip()
        for name, rx in PATTERNS:
            if name in hits:
                continue
            m = rx.search(line)
            if m:
                hits[name] = ts(line)
                if name in ('displayed', 'appjs', 'initok', 'paint', 'home'):
                    payload[name] = m.group(1)
    base = hits.get('proc')
    if base is None:
        print('  run %d  (no process line; TotalTime=%sms)' % (idx, tt))
        return
    row = ['run %d' % idx, 'TotalTime=%sms' % tt]
    for name, _ in PATTERNS:
        if name == 'proc':
            continue
        if name not in hits:
            row.append(name + '=?')
        elif name == 'displayed':
            row.append('displayed=%+dms(%s)' % (hits[name] - base, payload.get(name, '?')))
        elif name in ('appjs', 'initok', 'paint', 'home'):
            # page-internal mark (relative to app.js start), plus its wall offset
            row.append('%s=+%sms/%+dms' % (name, payload.get(name, '?'), hits[name] - base))
        else:
            row.append('%s=%+dms' % (name, hits[name] - base))
    print('  ' + '  '.join(row))
    if 'jsstart' in hits:
        d = []
        for name in ('homescreen', 'loadstart', 'paint', 'home'):
            if name in hits:
                d.append('%s=%+d' % (name, hits[name] - hits['jsstart']))
        if d:
            print('    (from jsstart)  ' + '  '.join(d))
    if navline:
        print('  ' + navline[:180])


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    print('base = process start; appjs/initok/paint/home are page-internal t+ marks')
    for i in range(n):
        one(i + 1)


main()
