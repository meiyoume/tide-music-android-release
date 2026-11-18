"""Verify the built APK contains the expected v1.9.3 content.

index.android.bundle is Hermes bytecode, not JS text: ASCII strings are stored 1 byte
per char, non-ASCII as UTF-16LE. So Chinese has to be searched as UTF-16LE bytes --
decoding the whole file as UTF-8 will never find it.

Usage: python tools/check-apk-strings.py [dirWithExtractedApkFiles]
"""
import os
import sys

tmp = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ['TEMP'], 'apkcheck3')

# (kind, file, needles) that must be PRESENT
present = [
    ('bundle', 'index.android.bundle', [
        '就是你的收藏',        # collectList, love
        '这是你自己的歌单',    # collectList, ul:
        'chartCovers',         # 榜单封面事件
        'fillBoardCovers',
        'setBootBackground',
    ]),
    ('web', 'index.html', [
        'tide.bootBg',
        'styles.css?v=6',
        'html,body{background:#0A0B0F',
        'scr-square',
        'scr-newlist',
        'scr-fav',                       # 新的「收藏」页签
        'id="favPlayAll"',
        'id="listFav"',
        'id="favSub"',
        'data-push="scr-search"',        # 首页搜索框 -> 搜索子页
        'data-tab-go="fav"',
        'data-native-page="history"',
        'data-tab-go="library"',
        'data-native-page="about"',
        'data-push="scr-newlist"',
        'id="plCollect"',
        'id="plShare"',
        'id="pShare"',
        'quick--three',        # 「我的」页三列快捷格
    ]),
    ('web', 'app.js', [
        'chartCovers',
        'syncBootBg',
        'loadSquare',
        'createPlaylist',
        'applyChartCover',
        'renderFavorites',
        'favPlayAll',
        'scr-fav',
    ]),
]

# Must be GONE (the de-duplication round + the tab reshuffle)
absent = [
    ('web', 'index.html', [
        'scr-set-playback', 'scr-set-download', 'scr-set-storage',
        'speedRange', 'cacheRange', 'rowlink',
        'data-tab-go="search"',   # 搜索不再是页签
        'page-head--tight',
    ]),
    ('web', 'app.js', [
        'speedRange', 'cacheRange',
    ]),
    ('web', 'styles.css', [
        'rowlink', 'storage__bar', 's-group--pad',
    ]),
]


def escaped(s):
    return ''.join(c if ord(c) < 128 else '\\u%04x' % ord(c) for c in s)


def find_in_file(path, needle):
    raw = open(path, 'rb').read()
    if needle.encode('utf-8') in raw:
        return 'utf-8'
    if needle.encode('utf-16-le') in raw:
        return 'utf-16le'
    if escaped(needle) in raw.decode('utf-8', 'replace'):
        return 'escaped'
    return None


fail = 0
for kind, name, needles in present:
    path = os.path.join(tmp, name)
    if not os.path.exists(path):
        print(f'MISSING FILE {name}')
        fail += 1
        continue
    for n in needles:
        how = find_in_file(path, n)
        if not how:
            fail += 1
        print(f'{"OK  " if how else "MISS"} present  {name:22} {n}')

for kind, name, needles in absent:
    path = os.path.join(tmp, name)
    if not os.path.exists(path):
        print(f'MISSING FILE {name}')
        fail += 1
        continue
    for n in needles:
        how = find_in_file(path, n)
        if how:
            fail += 1
        print(f'{"OK  " if not how else "STILL"} absent   {name:22} {n}')

print()
print('FAILURES:', fail)
sys.exit(1 if fail else 0)
