"""打开榜单页时到底发了几个封面请求（验证「滚到哪取到哪」真的生效）。

之前是一次性把 43 个榜单的首页全取一遍，现在应该只有首屏看得见的那几张。
"""
import re
import subprocess
import time
from collections import Counter

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
TAB_CHARTS = (405, 2190)   # 底部「榜单」页签中心


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True).stdout.decode('utf-8', 'replace')


def reqs():
    log = adb('logcat', '-d', '-v', 'time')
    out = []
    for line in log.splitlines():
        s = re.search(r"---start---', '([^']+)'", line)
        if s:
            out.append(s.group(1))
    return out


adb('shell', 'am', 'force-stop', PKG)
time.sleep(3)
adb('logcat', '-c')
adb('shell', 'am', 'start', '-n', ACT)
time.sleep(14)
startup = reqs()
print('冷启动到首屏：%d 个请求' % len(startup))
for u, n in Counter(re.sub(r'\?.*$', '', u) for u in startup).most_common(8):
    print('  %3d 次  %s' % (n, u[:100]))

adb('logcat', '-c')
adb('shell', 'input', 'tap', str(TAB_CHARTS[0]), str(TAB_CHARTS[1]))
time.sleep(12)
tab = reqs()
print('\n进榜单页（首屏可见的那几张）：%d 个请求' % len(tab))
for u, n in Counter(re.sub(r'\?.*$', '', u) for u in tab).most_common(8):
    print('  %3d 次  %s' % (n, u[:100]))
