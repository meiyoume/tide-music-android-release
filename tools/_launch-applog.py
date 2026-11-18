"""冷启动时把 App 自己进程的全部 logcat 行按时间打出来（不做关键字过滤）。

过滤版（_launch-timeline.py）只能看到我预先想到的关键字；这次要查的是
「主线程被占住那几秒到底在干什么」，所以宁滥勿缺。
"""
import re
import subprocess
import time

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True).stdout.decode('utf-8', 'replace')


adb('shell', 'am', 'force-stop', PKG)
time.sleep(3)
adb('logcat', '-c')
adb('shell', 'am', 'start', '-n', ACT)
time.sleep(14)

log = adb('logcat', '-d', '-v', 'time')
pid = None
rows = []
for line in log.splitlines():
    m = re.match(r'(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+\w/\S*\(\s*(\d+)\)', line)
    if not m:
        continue
    if pid is None:
        sp = re.search(r'Start proc (\d+):%s' % re.escape(PKG), line)
        if sp:
            pid = sp.group(1)
    rows.append((m.group(1), m.group(2), line))

if pid is None:
    print('没找到进程 pid')
    raise SystemExit(1)
print('pid = %s，只打这个进程的行\n' % pid)

# 从 Displayed 开始算相对时间
base = None
for t, p, line in rows:
    if 'Displayed ' in line and base is None:
        base = t
        break


def secs(t):
    """'10-08 08:44:56.912' -> 当天的秒数（去掉日期，只留 HH:MM:SS.mmm）"""
    hms = t.split(' ')[-1]
    h, mi, s = hms.split(':')
    return int(h) * 3600 + int(mi) * 60 + float(s)


def rel(t):
    return 0.0 if base is None else secs(t) - secs(base)


for t, p, line in rows:
    if p != pid:
        continue
    r = rel(t)
    if r < -2:
        continue
    # 去掉行首的时间戳与级别，只留 tag 和正文
    body = re.sub(r'^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+', '', line)
    body = re.sub(r'\(\s*%s\)' % pid, '', body)
    print('  +%6.2fs  %s' % (r, body.strip()[:180]))
