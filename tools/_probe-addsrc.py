"""只走「我的 → 添加歌源 → 填地址 → 导入 → 删除」这一段，用来调试验收脚本。

比起每次都跑整条 flow（4 分钟），这里只碰这一页，改一次几十秒。
顺带把「WebView 里的 input 在 uiautomator 里长什么样」「adb shell input text
能不能打出一个 URL」这两件事查清楚 —— 验收脚本要靠它们。
"""
import functools
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\probeadd_ui.xml')
SRC = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android\tools\builtin-sources-src\helloworld.js')


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/probeadd_ui.xml')
    adb('pull', '/sdcard/probeadd_ui.xml', str(DUMP))
    text = DUMP.read_text(encoding='utf-8', errors='replace')
    out = []
    for m in re.finditer(r'<node[^>]*>', text):
        tag = m.group(0)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not b:
            continue
        x1, y1, x2, y2 = (int(g) for g in b.groups())
        if x2 == 0 and y2 == 0:
            continue
        t = re.search(r'text="([^"]*)"', tag)
        d = re.search(r'content-desc="([^"]*)"', tag)
        c = re.search(r'clickable="(\w+)"', tag)
        cls = re.search(r'class="([^"]*)"', tag)
        out.append({'text': (t.group(1) if t else '') or (d.group(1) if d else ''),
                    'class': cls.group(1) if cls else '',
                    'clickable': c.group(1) == 'true' if c else False,
                    'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2,
                    'w': x2 - x1, 'h': y2 - y1, 'top': y1})
    return out


def tap(n, wait=1.5):
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)


def shot(name):
    SHOTS.mkdir(exist_ok=True)
    (SHOTS / ('dev-%s.png' % name)).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    print('    shot -> dev-%s.png' % name)


def tap_text(pat, wait=2.0, want=0, last=False):
    hits = [n for n in nodes() if re.search(pat, n['text'])]
    if not hits:
        print('    找不到「%s」' % pat)
        return False
    n = max(hits, key=lambda x: x['y']) if last else hits[want]
    tap(n, wait)
    return True


class H11(SimpleHTTPRequestHandler):
    """HTTP/1.1 + 明确 `Connection: close` 的服务端。

    默认的 `SimpleHTTPRequestHandler` 是 **HTTP/1.0**：它会用 `HTTP/1.0 200 OK`
    回一个 **HTTP/1.1 + `Connection: Keep-Alive`** 的请求，而且因为
    `close_connection=False` 它**不关连接**。OkHttp 收到 HTTP/1.0 的响应会认为
    「这连接该关了」，于是自己关/等 —— 这个组合在模拟器上表现得很不稳：
    服务端日志里那条 GET 明明是 200，App 那边却抛 `Network request failed`
    （RN 把它翻译成「无法连接到服务器」）。真实音源地址都是正经 HTTP/1.1 服务端，
    所以这里把测试服务端也做成 HTTP/1.1 + `Connection: close`。
    """
    protocol_version = 'HTTP/1.1'

    def end_headers(self):
        self.send_header('Connection', 'close')
        super().end_headers()


def serve():
    text = SRC.read_text(encoding='utf-8')
    text = re.sub(r'@name[^\n]*', '@name 潮汐测试音源', text, count=1)
    text = re.sub(r'@version[^\n]*', '@version 1.0.0', text, count=1)
    d = Path(tempfile.mkdtemp(prefix='tide-src-'))
    (d / 'tide-test.js').write_text(text, encoding='utf-8')
    srv = ThreadingHTTPServer(('127.0.0.1', 0),
                              functools.partial(H11, directory=str(d)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://10.0.2.2:%d/tide-test.js' % srv.server_address[1]


def main():
    # 允许直接给一个 URL（用来对照：宿主机 HTTP 失败、公网 HTTPS 成不成功）
    given = [a for a in sys.argv[1:] if not a.startswith('--')]
    if given:
        srv, url = None, given[0]
    else:
        srv, url = serve()
    print('    测试脚本地址 %s' % url)
    # `--keep` 不重启 App（App 已经在「添加音源」页上时用，省 24 秒）
    keep = '--keep' in sys.argv
    if not keep:
        adb('shell', 'am', 'force-stop', PKG)
        time.sleep(1)
        adb('shell', 'am', 'start', '-n', ACT)
        time.sleep(24)
        for _ in range(6):
            if 'harmony' in adb('shell', 'dumpsys', 'window'):
                break
            time.sleep(3)
        for _ in range(4):
            if tap_text(r'^我的$', 2.5, last=True):
                break
            time.sleep(1)
        shot('z-add-01-mine')
        if not tap_text(r'添加歌源', 3.5):
            print('    打不开添加音源页')
            return
        shot('z-add-02-page')
    print('    ---- 添加音源页节点 ----')
    for x in nodes():
        if x['text'] or x['clickable']:
            print('    %-30s %-22s %s %dx%d @%d,%d' %
                  (x['text'][:30], x['class'].split('.')[-1][:22],
                   'click' if x['clickable'] else '     ', x['w'], x['h'], x['x'], x['y']))

    # 地址输入框。先确保页面在顶部 —— 上一轮可能滚下去了，输入框和「导入」
    # 都在屏幕外，uiautomator 找不到（或者给出屏幕外的坐标，点了等于没点）。
    for _ in range(5):
        if any(n['class'].endswith('EditText') for n in nodes()):
            break
        adb('shell', 'input', 'swipe', '540', '900', '540', '1800', '250')
        time.sleep(0.9)
    box = None
    for n in nodes():
        if n['class'].endswith('EditText'):
            box = n
            break
    if not box:
        print('    !! uiautomator 里没有 EditText 节点，输入框只能用坐标')
        box = {'x': 540, 'y': 716}
    print('    输入框在 %s,%s' % (box['x'], box['y']))
    tap(box, 1.5)
    shot('z-add-03-focus')
    # 先把框里原有的字清掉：input text 是**追加**，不清的话会拼成
    # `http://10.0.2.https://...2:37991/tide-test.js` 这种怪物（第一次就踩到了）
    adb('shell', 'input', 'keyevent', '123')                    # MOVE_END
    adb('shell', 'input', 'keyevent', *(['67'] * 120))          # DEL ×120
    time.sleep(0.8)
    adb('shell', 'input', 'text', url)
    time.sleep(1.2)
    shot('z-add-04-typed')
    print('    打完字之后节点里的输入框内容：%s' %
          [(n['text'] or '(空)') for n in nodes() if n['class'].endswith('EditText')])

    # 收键盘：点一下分组标题（不能按返回键，那会退出子页）
    if any(n['text'] == '从在线地址导入' for n in nodes()):
        tap_text(r'^从在线地址导入$', wait=1.0)
        shot('z-add-04b-kbd-hidden')
    ok = False
    for i in range(4):
        if tap_text(r'^导入$', 8):
            ok = True
            break
        print('    第 %d 次没找到「导入」，再 dump 一次' % (i + 1))
        time.sleep(0.8)
    if not ok:
        print('    找不到「导入」按钮')
        return
    shot('z-add-05-imported')
    print('    导入后页面文字：%s' % ' | '.join(x['text'] for x in nodes() if x['text'])[:600])
    trash = [n for n in nodes() if n['text'] == '删除']
    print('    删除键数量 %d' % len(trash))
    # 最后一行常常压在底栏下面 —— 直接点会点到「我的」页签（第一次就踩到了）。
    # 先往上滑，直到那颗删除键落到安全区里再点。
    target = None
    for _ in range(6):
        cands = [n for n in nodes() if n['text'] == '删除' and n['y'] < 2000]
        if cands:
            target = max(cands, key=lambda x: x['y'])
            break
        adb('shell', 'input', 'swipe', '540', '1700', '540', '900', '300')
        time.sleep(1.2)
    # 找**新导入那条**（名字里带「潮汐测试」）的垃圾桶。
    # 别按「y 最大的删除键」取 —— 新那条在列表最后、常常整行都在屏幕外，
    # 屏幕内 y 最大的那颗是别的行（第一次就这么删错了行）。
    def trash_of(keyword):
        for _ in range(6):
            ns = nodes()
            row = next((n for n in ns if keyword in n['text']), None)
            if row:
                cands = [n for n in ns if n['text'] == '删除' and abs(n['y'] - row['y']) < 140]
                if cands:
                    t = min(cands, key=lambda x: abs(x['y'] - row['y']))
                    if t['y'] < 2000:
                        return t
            adb('shell', 'input', 'swipe', '540', '1700', '540', '900', '300')
            time.sleep(1.2)
        return None

    def confirm_delete():
        """点确认态里那颗「删除」—— 按「离『取消』最近」取。

        屏幕上同时有两种「删除」：每行的垃圾桶和确认态里的红胶囊。
        按文字取第一个会取到**别的行**的垃圾桶（第一轮实测：点了删除，
        确认态跑到另一行去了，什么都没删掉）。
        """
        ns = nodes()
        cancel = next((n for n in ns if n['text'] == '取消'), None)
        if not cancel:
            print('    没找到「取消」（确认态没出现？）')
            return False
        cands = [n for n in ns if n['text'] == '删除' and abs(n['y'] - cancel['y']) < 80]
        if not cands:
            return False
        n = min(cands, key=lambda x: abs(x['x'] - cancel['x']))
        tap(n, 3)
        return True

    t = trash_of('潮汐测试')
    if not t:
        print('    找不到新导入那条的删除键')
    else:
        print('    点新那条的垃圾桶 @%d,%d' % (t['x'], t['y']))
        tap(t, 1.2)
        shot('z-add-06-confirm')
        txt = ' | '.join(x['text'] for x in nodes() if x['text'])
        print('    点垃圾桶后：%s' % txt[:300])
        print('    确认态出现：%s' % ('是' if '取消' in txt else '否'))
        # 先点一次「取消」，确认不会真删
        tap_text(r'^取消$', wait=1.5)
        print('    点「取消」后那条还在：%s' % ('是' if '潮汐测试' in ' | '.join(
            x['text'] for x in nodes() if x['text']) else '否'))
        t = trash_of('潮汐测试')
        if t:
            tap(t, 1.2)
            if confirm_delete():
                shot('z-add-07-deleted')
                print('    删完：%s' % ' | '.join(x['text'] for x in nodes() if x['text'])[:400])
                print('    那条不见了：%s' % ('是' if '潮汐测试' not in ' | '.join(
                    x['text'] for x in nodes() if x['text']) else '否'))
    if srv:
        srv.shutdown()


main()
