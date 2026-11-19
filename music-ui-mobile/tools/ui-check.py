"""Run tools/ui-check.html headlessly and print the checklist it produced.

Usage: python tools/ui-check.py
"""
import os
import shutil
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(__file__).resolve().parent.parent

result = {}
done = threading.Event()


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        result['body'] = self.rfile.read(n).decode('utf-8', 'replace')
        self.send_response(204)
        self.end_headers()
        done.set()

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

# 每次跑用一个全新的 profile 目录。
# 以前是固定的 %TEMP%/edgeprof-uicheck —— 上一次被 kill 掉的 Edge 子进程
# 还占着它的话，新实例会连到那个残留 profile 上，页面根本不加载，
# 外面只能等到 75 秒超时（2026-10-09 实测踩到：先报「等不到结果」，
# 而 tasklist 里躺着 11 个 msedge.exe）。用随机目录 + 跑完删掉，既避开残留，
# 也不会去动用户自己开着的浏览器。
profile = Path(tempfile.mkdtemp(prefix='edgeprof-uicheck-'))

url = f'http://127.0.0.1:{port}/tools/ui-check.html'
# 浏览器这一半交给 Node（tools/_edge-open.mjs）：这台机器上从 Python 的
# subprocess 里拉 msedge 会 0.1 秒退出（rc 0、不打开页面），换 Node 的
# spawn 就正常。服务器与结果收集仍留在这里。
proc = subprocess.Popen(
    ['node', str(ROOT / 'tools' / '_edge-open.mjs'), url, '200', '500', '960'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

if not done.wait(240):
    proc.kill()
    server.shutdown()
    shutil.rmtree(profile, ignore_errors=True)
    print('等不到结果（240 秒）')
    raise SystemExit(1)

proc.kill()
server.shutdown()
shutil.rmtree(profile, ignore_errors=True)
body = result['body']
print(body)
raise SystemExit(1 if 'FAIL' in body or '异常' in body else 0)
