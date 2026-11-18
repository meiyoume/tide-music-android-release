"""量 App 冷启动：启动耗时 + 各阶段时间点 + 启动过程每一帧的颜色。

为什么单独写一个：说「打开慢」和「打开闪一下」都需要数字。
  · 耗时看 `am start -W` 的 TotalTime 与 logcat 的 `Displayed ... +NNNms`；
  · 「闪」看设备端连续抓帧（本机没有 ffmpeg，screenrecord 的 mp4 解不出来），
    逐帧算平均色，颜色突变的地方就是闪。

用法:
  python tools/measure-launch.py            # 冷启动 + 暖启动各一次，打印时间线
  python tools/measure-launch.py frames     # 另外抓 40 帧，逐帧报平均色
"""
import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
FRAMES = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android\shots\launch')


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def start(label):
    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(2)
    adb('logcat', '-c')
    t0 = time.time()
    out = adb('shell', 'am', 'start', '-W', '-n', ACT)
    wall = time.time() - t0
    print('\n=== %s' % label)
    for line in out.splitlines():
        if re.search(r'(TotalTime|WaitTime|LaunchState|Status):', line):
            print('  am start  %s' % line.strip())
    print('  am start 往返 %.2fs' % wall)
    time.sleep(9)

    log = adb('logcat', '-d', '-v', 'time')
    print('  --- 关键时间点（logcat）')
    keys = re.compile(r'(Displayed .*?\+([\d]+)ms|Fully drawn|'
                      r'ActivityTaskManager: START|'
                      r'\[TideWeb\]|ReactNativeJS|Choreographer|'
                      r'ActivityManager: Start proc|SoLoader|'
                      r'cn\.tos|\+\d+ms)')
    for line in log.splitlines():
        if 'TideWeb' in line or 'Displayed' in line or 'Fully drawn' in line:
            print('    %s' % line.strip()[:170])


def frames(n=40, delay_ms=250):
    """设备端连续 screencap，每帧记一次设备时间 —— 这样才能说「第几秒才出画面」。

    不记时间的话只能按「大概 0.5 秒一帧」估，估出来的空白时长差一倍都可能。
    时间基准用设备时钟（先取一次 date，再 am start，两边同一个钟）。
    """
    print('\n=== 抓 %d 帧（每帧一张 screencap）' % n)
    FRAMES.mkdir(parents=True, exist_ok=True)
    for f in FRAMES.glob('fl_*.png'):
        f.unlink()
    adb('shell', 'am', 'force-stop', PKG)
    adb('shell', 'rm', '-f', '/sdcard/fl_*.png', '/sdcard/fl_times.txt')
    time.sleep(2)

    # 抓帧循环：每帧前记一次时间戳（date +%s%3N 是毫秒）
    dev = ('i=0; while [ $i -lt %d ]; do date +%%s%%3N >> /sdcard/fl_times.txt; '
           'screencap -p /sdcard/fl_$i.png; i=$((i+1)); done; echo DONE' % n)
    subprocess.Popen([ADB, 'shell', dev], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(delay_ms / 1000.0)
    t_start = int(adb('shell', 'date', '+%s%3N').strip())
    adb('shell', 'am', 'start', '-n', ACT)
    time.sleep(n * 0.6 + 6)

    for i in range(n):
        adb('pull', '/sdcard/fl_%d.png' % i, str(FRAMES / ('fl_%02d.png' % i)))
    adb('pull', '/sdcard/fl_times.txt', str(FRAMES / 'times.txt'))
    adb('shell', 'rm', '-f', '/sdcard/fl_*.png', '/sdcard/fl_times.txt')

    stamps = [int(x) for x in (FRAMES / 'times.txt').read_text().split() if x.isdigit()]

    from PIL import Image
    print('  （t=0 是 am start 那一刻）')
    print('   帧    t(ms)  平均色      中心色     说明')
    prev = None
    for i in range(n):
        p = FRAMES / ('fl_%02d.png' % i)
        if not p.exists():
            continue
        im = Image.open(p).convert('RGB')
        small = im.resize((40, 80))
        px = list(small.getdata())
        avg = tuple(sum(c[k] for c in px) // len(px) for k in range(3))
        cx, cy = im.size[0] // 2, im.size[1] // 2
        cen = im.getpixel((cx, cy))
        tag = ''
        if prev is not None:
            d = sum(abs(a - b) for a, b in zip(avg, prev))
            if d > 24:
                tag = '<<< 变化 %d' % d
        prev = avg
        dt = (stamps[i] - t_start) if i < len(stamps) else -1
        print('  %3d  %6d  %-11s %-11s %s'
              % (i, dt, '#%02X%02X%02X' % avg, '#%02X%02X%02X' % cen, tag))
    print('  帧图在 %s' % FRAMES)


def sweep(delays_ms):
    """每个延时单独冷启动一次，只在末尾拍一张 —— 抓帧循环本身会拖慢被测对象。

    连续 screencap 的代价很大（本机模拟器一张要 0.7~0.9 秒），跑循环时它一直在抢
    CPU，会把 App 主线程的 Choreographer 卡出成百上千帧，测出来的「空白时长」
    其实是自己压出来的。所以改成「一次启动、一张图」，一次只加一张的开销。

    判据用颜色标准差：空白页是一整块底色（std 接近 0），有内容就会花起来。
    """
    from PIL import Image
    import statistics

    print('\n=== 逐档延时各冷启动一次（每次只拍一张）')
    print('   延时(ms)  平均色      标准差   判定')
    for d in delays_ms:
        adb('shell', 'am', 'force-stop', PKG)
        adb('shell', 'rm', '-f', '/sdcard/sw.png')
        time.sleep(3)
        adb('shell', 'am', 'start', '-n', ACT)
        time.sleep(d / 1000.0)
        adb('shell', 'screencap', '-p', '/sdcard/sw.png')
        dest = FRAMES / ('sw_%05d.png' % d)
        adb('pull', '/sdcard/sw.png', str(dest))
        im = Image.open(dest).convert('RGB')
        # 裁掉状态栏/导航栏，只看 App 的内容区
        w, h = im.size
        im = im.crop((0, int(h * 0.06), w, int(h * 0.94)))
        small = im.resize((40, 80))
        px = list(small.getdata())
        avg = tuple(sum(c[k] for c in px) // len(px) for k in range(3))
        lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
        sd = statistics.pstdev(lum)
        # 空白页 sd 通常 < 3；有文字和卡片之后 > 12（实测两档差得很开）
        verdict = '有内容' if sd > 8 else '空白'
        print('  %8d  %-11s %7.1f   %s' % (d, '#%02X%02X%02X' % avg, sd, verdict))


def one(delay_ms):
    """一次冷启动，等到指定延时拍一张，同时把页面侧的 t+ 埋点打出来。

    和 sweep 的区别：这个带 logcat，能对着「页面自己说什么时候画完了」看
    「屏幕什么时候真的有东西」—— 两者差多少就是主线程被占住的时间。
    """
    from PIL import Image
    import statistics

    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(3)
    adb('logcat', '-c')
    out = adb('shell', 'am', 'start', '-W', '-n', ACT)
    for line in out.splitlines():
        if re.search(r'(TotalTime|WaitTime|Status):', line):
            print('  %s' % line.strip())
    time.sleep(delay_ms / 1000.0)
    adb('shell', 'screencap', '-p', '/sdcard/one.png')
    dest = FRAMES / ('one_%05d.png' % delay_ms)
    adb('pull', '/sdcard/one.png', str(dest))

    im = Image.open(dest).convert('RGB')
    w, h = im.size
    body = im.crop((0, int(h * 0.06), w, int(h * 0.94)))
    px = list(body.resize((40, 80)).getdata())
    lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
    print('  延时 %dms 时屏幕：平均色 %s  标准差 %.1f  %s'
          % (delay_ms,
             '#%02X%02X%02X' % tuple(sum(c[k] for c in px) // len(px) for k in range(3)),
             statistics.pstdev(lum),
             '有内容' if statistics.pstdev(lum) > 8 else '空白'))

    log = adb('logcat', '-d', '-v', 'time')
    for line in log.splitlines():
        if 'TideWeb' in line or 'Skipped' in line or 'Displayed ' in line:
            print('    %s' % line.strip()[:170])
    print('  图在 %s' % dest)


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else 'time'
    if what == 'time':
        start('冷启动（force-stop 之后）')
        start('暖启动（进程还在）')
    elif what == 'one':
        one(int(sys.argv[2]) if len(sys.argv) > 2 else 5000)
    elif what == 'sweep':
        ds = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 \
            else [800, 1200, 1600, 2000, 2500, 3000, 4000, 6000]
        sweep(ds)
    else:
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
        d = int(sys.argv[3]) if len(sys.argv) > 3 else 250
        frames(n, d)


main()
