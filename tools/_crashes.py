"""看 logcat 里那几条 FATAL EXCEPTION 到底是哪个进程崩的（验收脚本会误报）。"""
import re
import subprocess

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
out = subprocess.run([ADB, 'logcat', '-d', '-v', 'brief'],
                     capture_output=True, text=True, errors='replace').stdout
lines = out.splitlines()
for i, l in enumerate(lines):
    if 'FATAL EXCEPTION' not in l:
        continue
    print('----', l[:160])
    for j in range(i + 1, min(i + 6, len(lines))):
        if re.search(r'Process:|Caused by|^\s+at ', lines[j]):
            print('    ', lines[j][:180])
