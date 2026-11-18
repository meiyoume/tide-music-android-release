"""Catch the Android 12+ launch splash (it shows the app icon) by bursting screenshots.

Usage: python tools/tide-splash.py <out-prefix>
"""
import subprocess
import sys
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = 'cn.toside.music.mobile.harmony/cn.toside.music.mobile.MainActivity'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
prefix = sys.argv[1] if len(sys.argv) > 1 else 'splash'

subprocess.run([ADB, 'shell', 'am', 'force-stop', PKG], capture_output=True)
subprocess.Popen([ADB, 'shell', 'am', 'start', '-n', ACT],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for i in range(8):
    data = subprocess.run([ADB, 'exec-out', 'screencap', '-p'], capture_output=True).stdout
    dest = SHOTS / f'{prefix}-{i}.png'
    dest.write_bytes(data)
    print(dest.name, len(data))
