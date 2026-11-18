"""Verify the arm64 release APK and copy it to the Desktop as the deliverable.

Checks (each one is a thing that silently went wrong before):
  - apksigner verify  -> a build that is not signed installs nowhere
  - the APK contains exactly one ABI (arm64-v8a) and no other lib/ dirs
  - every file the web UI needs is present under assets/tide/
  - assets/tide/* 的**内容**与构建输入逐字节一致（不然交出去的可能是上一版界面）
  - 构建输入不比界面源码旧（源码改过却忘了 sync 的话，这里会报出来）
  - the APK's versionName matches package.json
  - SHA256 + size for the record

⚠️ 2026-11-18 起 assets/tide 里的 JS/CSS 是**压缩过**的（tools/sync-tide-assets.mjs
顺手压缩），所以不能拿它跟 music-ui-mobile 的源码逐字节比 —— 要跟 sync 的产物
（android/app/src/main/assets/tide/）比。源码是否更新过，改用 mtime 判断。

Usage: python tools/deliver-arm64.py 1.9.12 [harmony|tablet]

两个包共用这一套校验：form=tablet 时还会确认 applicationId 是 .tablet、
桌面名字是「潮汐音乐 Pad」，免得把手机包当平板包交出去。
"""
import hashlib
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android')
STAGING = ROOT / 'build-staging'
# 2026-11-18 用户要求：AI 做的安装包统一放桌面这个文件夹，且每次只留最新版
OUT_DIR = Path(r'C:\Users\meiyou\Desktop\ai做的安装包')
UI_SRC = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
BUILD_ASSETS = ROOT / 'android' / 'app' / 'src' / 'main' / 'assets' / 'tide'
JAVA_HOME = r'D:\android-tools\jdk17'
APKSIGNER = r'D:\android-tools\sdk\build-tools\35.0.0\apksigner.bat'
NEED_ASSETS = {'index.html', 'styles.css', 'sfx.js', 'api.js', 'app.js'}

version = sys.argv[1] if len(sys.argv) > 1 else '1.9.8'
form = sys.argv[2] if len(sys.argv) > 2 else 'harmony'
apks = sorted(STAGING.glob(f'*-v{version}-{form}-arm64-v8a.apk'))
if not apks:
    print(f'没有找到 v{version} 的 {form} arm64 包')
    raise SystemExit(1)
apk = apks[-1]
print(f'APK   {apk.name}  {apk.stat().st_size / 1048576:.2f} MB')

# 1) 签名
r = subprocess.run([APKSIGNER, 'verify', '--print-certs', str(apk)],
                   capture_output=True, text=True,
                   env={'JAVA_HOME': JAVA_HOME, 'PATH': JAVA_HOME + r'\bin;' + __import__('os').environ['PATH']})
ok_sign = r.returncode == 0
print(f'签名  {"ok" if ok_sign else "FAILED"}  {r.stdout.strip().splitlines()[:1]}')
if not ok_sign:
    print(r.stdout[-800:], r.stderr[-800:])

# 2) ABI + assets
with zipfile.ZipFile(apk) as z:
    names = z.namelist()
    libs = sorted({n.split('/')[1] for n in names if n.startswith('lib/')})
    assets = {n.split('/')[-1] for n in names if n.startswith('assets/tide/')}
    bundle = [n for n in names if n.endswith('index.android.bundle')]
    # 界面资源的实际内容：跟源码逐字节比，确认打包时同步过、而且不是上一版的
    apk_assets = {n.split('/')[-1]: hashlib.sha256(z.read(n)).hexdigest()
                  for n in names if n.startswith('assets/tide/')}
print(f'ABI   {libs}')
print(f'assets/tide  {sorted(assets)}')
print(f'bundle  {bundle}')

stale = []
for name in sorted(NEED_ASSETS):
    built = BUILD_ASSETS / name
    if not built.exists():
        continue
    if apk_assets.get(name) != hashlib.sha256(built.read_bytes()).hexdigest():
        stale.append(name)
print(f'界面资源与构建输入一致  {"ok" if not stale else "不一致：" + ",".join(stale)}')

# 源码改过却没重新 sync 的话，构建输入会比源码旧 —— 交出去的还是上一版界面
old_assets = []
for name in sorted(NEED_ASSETS):
    src = UI_SRC / name
    built = BUILD_ASSETS / name
    if src.exists() and built.exists() and built.stat().st_mtime + 1 < src.stat().st_mtime:
        old_assets.append(name)
print(f'构建输入不旧于界面源码  {"ok" if not old_assets else "过期：" + ",".join(old_assets)}')

# 3) 版本号 / 安装身份（aapt 在 build-tools 里）
aapt = Path(r'D:\android-tools\sdk\build-tools\35.0.0\aapt.exe')
ver_name = None
pkg_name = None
label = None
if aapt.exists():
    # 必须显式 utf-8：aapt 输出里有 UTF-8 字节，Windows 默认 GBK 解码会炸
    # （2026-11-15 实测：_readerthread UnicodeDecodeError，stdout 变 None）
    r2 = subprocess.run([str(aapt), 'dump', 'badging', str(apk)],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    # aapt 的输出顺序是 versionCode 在前、versionName 在后；别用一个按顺序匹配的正则
    m_name = re.search(r"versionName='([^']+)'", r2.stdout)
    m_code = re.search(r"versionCode='([^']+)'", r2.stdout)
    m_pkg = re.search(r"package: name='([^']+)'", r2.stdout)
    m_label = re.search(r"application-label:'([^']+)'", r2.stdout)
    ver_name = m_name.group(1) if m_name else None
    pkg_name = m_pkg.group(1) if m_pkg else None
    label = m_label.group(1) if m_label else None
    print(f'版本  {(ver_name, m_code.group(1) if m_code else "?") if ver_name else "读不到"}')
    print(f'身份  {pkg_name}  {label}')

sha = hashlib.sha256(apk.read_bytes()).hexdigest().upper()
print(f'SHA256  {sha}')

problems = []
if not ok_sign:
    problems.append('签名校验没过')
if libs != ['arm64-v8a']:
    problems.append(f'ABI 不是纯 arm64：{libs}')
if not NEED_ASSETS.issubset(assets):
    problems.append(f'assets 缺文件：{sorted(NEED_ASSETS - assets)}')
if not bundle:
    problems.append('没有 index.android.bundle')
if stale:
    problems.append(f'界面资源不是最新（先跑 node tools/sync-tide-assets.mjs 再重新打包）：{stale}')
if old_assets:
    problems.append(f'构建输入比界面源码旧（改了界面没 sync，交出去还是旧界面）：{old_assets}')
if ver_name and ver_name != version:
    problems.append(f'APK 的 versionName={ver_name}，和要交付的 {version} 不一致')
# 安装身份：手机版与平板版必须对得上，否则会互相覆盖安装
expect_pkg = 'cn.toside.music.mobile.harmony' + ('.tablet' if form == 'tablet' else '')
if pkg_name and pkg_name != expect_pkg:
    problems.append(f'applicationId={pkg_name}，应该是 {expect_pkg}')
if form == 'tablet' and label and 'Pad' not in label:
    problems.append(f'桌面名字={label}，平板版应该是「潮汐音乐 Pad」')

if problems:
    print('\n不能交付：')
    for p in problems:
        print('  - ' + p)
    raise SystemExit(1)

dest_name = f'潮汐音乐-{"平板版" if form == "tablet" else "手机版"}-{version}.apk'
OUT_DIR.mkdir(parents=True, exist_ok=True)
dest = OUT_DIR / dest_name
shutil.copy2(apk, dest)
print(f'\n已交付  {dest}  {dest.stat().st_size / 1048576:.2f} MB')

# 同一个产品只留最新版：删掉这个文件夹里同系列（手机/平板）的旧包。
# 名字同时认新命名（潮汐音乐-手机版-*.apk）和旧命名（TideMusic-v*-arm64.apk），
# 免得之前放在桌面、后来搬进来的旧包残留。别的项目的包一律不动。
family = '平板版' if form == 'tablet' else '手机版'
patterns = [f'潮汐音乐-{family}-*.apk']
patterns.append('TideMusic-Pad-v*-arm64.apk' if form == 'tablet' else 'TideMusic-v*-arm64.apk')
removed = []
for pat in patterns:
    for old in OUT_DIR.glob(pat):
        if old.name == dest_name:
            continue
        old.unlink()
        removed.append(old.name)
if removed:
    print('删掉旧包：' + '，'.join(sorted(removed)))
