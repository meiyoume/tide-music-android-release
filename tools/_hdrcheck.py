"""查「从在线地址导入」为什么在模拟器上报「无法连接到服务器」。

已确认的事：
  * 宿主机 Python 服务端**记到了那条 GET，而且回的是 200**（带 `?_=` 缓存戳，
    这是 RN 的 fetch/whatwg-fetch 才有的行为）；
  * 模拟器里用 `nc` 打同一台宿主机、同一个端口，HTTP/1.0 一问一答正常；
  * 换成公网 HTTPS 地址，下载**成功**了（不再报连接失败，改成报内容为空）。

所以不是网络不通。这里把请求头打出来，看那条 GET 到底是不是 App 的 fetch 发的。
"""
import functools
import re
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\hdr_ui.xml')
SRC = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android\tools\builtin-sources-src\helloworld.js')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        print('==== 收到 GET %s' % self.path)
        for k, v in self.headers.items():
            print('     %s: %s' % (k, v[:120]))
        print('     protocol_version = %s' % self.protocol_version)
        return super().do_GET()

    def log_message(self, *a):
        pass


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/hdr_ui.xml')
    adb('pull', '/sdcard/hdr_ui.xml', str(DUMP))
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
        cls = re.search(r'class="([^"]*)"', tag)
        out.append({'text': (t.group(1) if t else '') or (d.group(1) if d else ''),
                    'class': cls.group(1) if cls else '',
                    'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2})
    return out


def tap_text(pat, wait=2.0, last=False):
    hits = [n for n in nodes() if re.search(pat, n['text'])]
    if not hits:
        print('    找不到「%s」' % pat)
        return False
    n = max(hits, key=lambda x: x['y']) if last else hits[0]
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)
    return True


def main():
    text = SRC.read_text(encoding='utf-8')
    text = re.sub(r'@name[^\n]*', '@name 潮汐测试音源', text, count=1)
    text = re.sub(r'@version[^\n]*', '@version 1.0.0', text, count=1)
    d = Path(tempfile.mkdtemp(prefix='hdr-src-'))
    (d / 'tide-test.js').write_text(text, encoding='utf-8')
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(d)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = 'http://10.0.2.2:%d/tide-test.js' % srv.server_address[1]
    print('服务端 http://127.0.0.1:%d，模拟器用 %s' % (srv.server_address[1], url))

    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(1)
    adb('shell', 'am', 'start', '-n', ACT)
    time.sleep(24)
    for _ in range(4):
        if tap_text(r'^我的$', 2.5, last=True):
            break
        time.sleep(1)
    if not tap_text(r'添加歌源', 3.5):
        print('    打不开添加音源页')
        return
    for _ in range(4):
        if any(n['class'].endswith('EditText') for n in nodes()):
            break
        adb('shell', 'input', 'swipe', '540', '900', '540', '1800', '250')
        time.sleep(0.9)
    box = next((n for n in nodes() if n['class'].endswith('EditText')), {'x': 540, 'y': 716})
    adb('shell', 'input', 'tap', str(box['x']), str(box['y']))
    time.sleep(1.2)
    adb('shell', 'input', 'keyevent', '123')
    adb('shell', 'input', 'keyevent', *(['67'] * 120))
    time.sleep(0.8)
    adb('shell', 'input', 'text', url)
    time.sleep(1.2)
    print('输入框内容：%s' % [(n['text'] or '(空)') for n in nodes() if n['class'].endswith('EditText')])
    tap_text(r'^导入$', 10)
    print('页面提示：%s' % ' | '.join(
        n['text'] for n in nodes() if '失败' in n['text'] or '成功' in n['text'] or '正在' in n['text']))
    srv.shutdown()


main()
