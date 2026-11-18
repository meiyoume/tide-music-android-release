"""查一下模拟器的网络：能不能到宿主机、有没有外网。

背景：v1.9.20 的「从在线地址导入」在模拟器上报「下载失败：无法连接到服务器」，
而宿主机的 Python 服务端**确实记到了那条 GET（200）**。两边矛盾，所以先量网络。
"""
import functools
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'


def adb(*args):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout.decode('utf-8', 'replace') + r.stderr.decode('utf-8', 'replace')


d = Path(tempfile.mkdtemp(prefix='netchk-'))
(d / 'hello.txt').write_text('hello from host\n', encoding='utf-8')
srv = ThreadingHTTPServer(('127.0.0.1', 0),
                          functools.partial(SimpleHTTPRequestHandler, directory=str(d)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
print('host server on 127.0.0.1:%d' % port)

print('\n-- 模拟器里有哪些 http 客户端 --')
for c in ('curl', 'wget', 'nc', 'ping', 'toybox'):
    print('  %-8s -> %s' % (c, adb('shell', 'which', c).strip().splitlines()[:1]))

print('\n-- 能到宿主机吗（10.0.2.2:%d） --' % port)
print(' ', adb('shell', "printf 'GET /hello.txt HTTP/1.0\\r\\n\\r\\n' | nc 10.0.2.2 %d" % port).strip()[:400])

print('\n-- 外网 TCP（baidu:80） --')
print(' ', adb('shell', "printf 'GET / HTTP/1.0\\r\\nHost: www.baidu.com\\r\\n\\r\\n' | nc www.baidu.com 80").strip()[:400])

print('\n-- 有外网吗 --')
print(' ', adb('shell', 'ping', '-c', '2', '-W', '3', '8.8.8.8').strip()[:300])
print(' ', adb('shell', 'ping', '-c', '2', '-W', '3', 'www.baidu.com').strip()[:300])

print('\n-- dns --')
print(' ', adb('shell', 'getprop', 'net.dns1').strip())

srv.shutdown()
