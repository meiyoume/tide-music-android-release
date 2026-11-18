"""冷启动时把 logcat 里跟启动有关的行按时间顺序列出来，找时间花在哪。"""
import re
import subprocess
import sys
import time

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'

KEYS = re.compile(
    r'Displayed |Fully drawn|START u0|Start proc|'
    r'ReactNativeJS|TideWeb|ReactNative|SoLoader|Hermes|'
    r'ActivityTaskManager|WindowManager: addWindow|Choreographer|'
    r'WebViewFactory|chromium|ActivityManager: Start proc|'
    r'AndroidRuntime|ANR |StrictMode|openDex|DexOpt|'
    r'HomeActivity|Navigation|RNN|ContentController'
)


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True).stdout.decode('utf-8', 'replace')


adb('shell', 'am', 'force-stop', PKG)
time.sleep(2)
adb('logcat', '-c')
adb('shell', 'am', 'start', '-n', ACT)
time.sleep(14)

log = adb('logcat', '-d', '-v', 'time')
base = None
for line in log.splitlines():
    m = re.match(r'(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)', line)
    if not m:
        continue
    if 'Displayed ' in line and base is None:
        base = m.group(1)
    if KEYS.search(line):
        print(line.strip()[:190])
