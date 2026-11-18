"""等模拟器启动完（`sys.boot_completed == 1`）。用法: python tools/_emu-wait.py [超时秒]"""
import subprocess
import sys
import time

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 300
start = time.time()
while time.time() - start < limit:
    boot = subprocess.run([ADB, 'shell', 'getprop', 'sys.boot_completed'],
                          capture_output=True, text=True).stdout.strip()
    if boot == '1':
        print('boot_completed=1，等了 %d 秒' % int(time.time() - start))
        raise SystemExit(0)
    time.sleep(8)
print('超时：还是没启动完')
raise SystemExit(1)
