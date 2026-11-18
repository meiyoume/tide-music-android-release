"""逐字节比 APK 内 `assets/tide/*` 与界面源目录的 SHA256。

为什么要有这一步：界面是纯 Web 资源，打进 APK 之前要经 `tools/sync-tide-assets.mjs`
拷一遍。以前出过「改了界面、忘了同步就打包」，装上去还是旧界面，
白白在设备上走一遍验收。这里把「APK 里的 app.js 是不是我刚改的那份」变成硬判据。

用法:
  python tools/check-apk-assets.py [apk] [源目录]
默认: android/app/build/outputs/apk/release/lx-music-mobile-*-arm64-v8a.apk
      + D:/anzhuang/deepseek-harness/music-ui-mobile
"""
import glob
import hashlib
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DEFAULT = r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile'
FILES = ['index.html', 'styles.css', 'app.js', 'api.js', 'sfx.js']


def sha(data):
    return hashlib.sha256(data).hexdigest().upper()


def main():
    apk = sys.argv[1] if len(sys.argv) > 1 else None
    if not apk:
        hits = glob.glob(os.path.join(
            ROOT, 'android/app/build/outputs/apk/release/*arm64-v8a.apk'))
        if not hits:
            print('找不到 APK，先打包')
            return 2
        apk = max(hits, key=os.path.getmtime)
    src = sys.argv[2] if len(sys.argv) > 2 else SRC_DEFAULT
    print('APK  %s' % apk)
    print('源   %s' % src)

    bad = 0
    with zipfile.ZipFile(apk) as z:
        names = set(z.namelist())
        for f in FILES:
            entry = 'assets/tide/' + f
            if entry not in names:
                print('  缺  %-12s APK 里没有这个文件' % f)
                bad += 1
                continue
            a = sha(z.read(entry))
            b = sha(open(os.path.join(src, f), 'rb').read())
            mark = 'OK ' if a == b else '不同'
            if a != b:
                bad += 1
            print('  %s %-12s %s' % (mark, f, a[:16]))
            if a != b:
                print('      APK %s' % a)
                print('      源  %s' % b)
    print('-- %s' % ('全部一致' if not bad else '%d 个不一致' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
