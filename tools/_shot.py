"""拍一张当前屏幕（排查用）。用法: python tools/_shot.py <名字>"""
import subprocess
import sys
from pathlib import Path

SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
SHOTS.mkdir(exist_ok=True)
name = sys.argv[1] if len(sys.argv) > 1 else 'now'
dest = SHOTS / ('dev-%s.png' % name)
dest.write_bytes(subprocess.run(
    [r'D:\android-tools\sdk\platform-tools\adb.exe', 'exec-out', 'screencap', '-p'],
    capture_output=True).stdout)
print(dest)
