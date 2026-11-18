"""把模拟器拉起来，并把它的输出写到日志文件里（启动失败时能看原因）。

`ANDROID_AVD_HOME` 必须显式给 —— 这个 shell 里没有那个环境变量。
不加 `-gpu` 之类的额外参数：用 AVD 自己的配置（之前手工启起来时就是这套）。
"""
import os
import subprocess
import sys
import time

SDK = r'D:\android-tools\sdk'
AVD_HOME = r'D:\android-tools\avd'
EMU = os.path.join(SDK, 'emulator', 'emulator.exe')
ADB = os.path.join(SDK, 'platform-tools', 'adb.exe')
LOG = r'D:\android-tools\_emu-restart.log'

avd = sys.argv[1] if len(sys.argv) > 1 else 'lx_phone'
env = dict(os.environ, ANDROID_HOME=SDK, ANDROID_SDK_ROOT=SDK, ANDROID_AVD_HOME=AVD_HOME)
with open(LOG, 'wb') as fh:
    subprocess.Popen([EMU, '-avd', avd, '-no-window', '-no-audio', '-no-boot-anim'],
                     env=env, stdout=fh, stderr=subprocess.STDOUT,
                     creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
print('emulator 启动中，日志 %s' % LOG)

start = time.time()
while time.time() - start < 300:
    boot = subprocess.run([ADB, 'shell', 'getprop', 'sys.boot_completed'],
                          capture_output=True, text=True).stdout.strip()
    if boot == '1':
        print('boot_completed=1，等了 %d 秒' % int(time.time() - start))
        break
    time.sleep(8)
else:
    print('300 秒还没启动完。日志尾部：')
    print(open(LOG, encoding='utf-8', errors='replace').read()[-2500:])
