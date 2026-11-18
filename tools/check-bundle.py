"""交付前的最后一道检查：APK 里的东西真的包含这一轮的改动吗？

为什么要这一步：`assets/tide/*`（Web 界面那五个文件）已经由 `check-apk-assets.py`
逐字节比过了，但**桥和内核的改动是编译进 `index.android.bundle` 的** —— 那个文件
没法逐字节比。这里用两条互补的判据：

1. **字符串字面量**：Hermes 会把代码编成字节码（`index.android.bundle` 头几个字节
   就是 Hermes 的 magic），但**字符串表是明文**，所以事件名、字段名这些能直接搜到。
   `homeLikes` 只出现在桥的 `loadHomeLikes` 里 —— 它在了，就说明这一轮的 bridge.ts
   确实编进来了（**纯逻辑没法按形状搜**：字节码里根本没有 `!==1` 这种文本，
   所以 `pickSpread` 的死循环修复只能靠「同一次构建」来保证）。
2. **构建顺序**：关键源文件的 mtime 必须早于 APK 的 mtime。防的是「改完源码忘了重新打包」。

用法: python tools/check-bundle.py [apk]
"""
import glob
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI_SRC = r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile'

apk = sys.argv[1] if len(sys.argv) > 1 else None
if not apk:
    hits = glob.glob(os.path.join(ROOT, 'build-staging/*arm64-v8a.apk'))
    apk = max(hits, key=os.path.getmtime) if hits else None
if not apk:
    print('找不到 APK')
    raise SystemExit(2)

# 字符串字面量类判据 -> 对应这一轮的哪个改动
NEEDLES = {
    'homeLikes': '猜你喜欢补足 30 首（事件名，只出现在桥的 loadHomeLikes 里）',
    'setTidePalette': '原生子页面配色跟着界面走',
    'web_albumpic_short': '酷我搜索封面（拼 img4.kuwo.cn 的那个字段）',
}
# 必须比 APK 旧的源文件（改了它们就要重新打包）
SOURCES = [
    os.path.join(ROOT, 'src/tide/bridge.ts'),
    os.path.join(ROOT, 'src/harmony/tokens.ts'),
    os.path.join(ROOT, 'src/harmony/useTokens.ts'),
    os.path.join(ROOT, 'src/utils/musicSdk/kw/musicSearch.js'),
    os.path.join(UI_SRC, 'app.js'),
    os.path.join(UI_SRC, 'index.html'),
    os.path.join(UI_SRC, 'styles.css'),
]

print('APK  %s' % apk)
apk_mtime = os.path.getmtime(apk)
with zipfile.ZipFile(apk) as z:
    names = [n for n in z.namelist() if n.endswith('index.android.bundle')]
    if not names:
        print('APK 里没有 index.android.bundle')
        raise SystemExit(1)
    raw = z.read(names[0])
bundle = raw.decode('utf-8', 'replace')
hermes = raw[:8].hex()

bad = 0
print('  bundle %.1f KB，头部 %s（Hermes 字节码，所以字符串表之外的东西搜不到）'
      % (len(raw) / 1024, hermes))
for needle, why in NEEDLES.items():
    hit = needle in bundle
    if not hit:
        bad += 1
    print('  %s  %-20s %s' % ('OK ' if hit else '缺 ', needle, why))

print('  构建顺序：')
for src in SOURCES:
    if not os.path.exists(src):
        print('    ?  %s（源文件不在）' % os.path.basename(src))
        continue
    newer = os.path.getmtime(src) > apk_mtime
    if newer:
        bad += 1
    print('    %s  %-18s %s' % ('OK ' if not newer else '旧包',
                                os.path.basename(src),
                                '比 APK 新！改完要重新打包' if newer else '早于 APK'))

print('-- %s' % ('都对得上' if not bad else '%d 项不对' % bad))
raise SystemExit(1 if bad else 0)
