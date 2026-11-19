"""Run the perf harness in headless Edge and print what it measured.

Why an HTTP server instead of file:// + --virtual-time-budget: virtual time
freezes the clock, so every performance.now() delta comes back 0. Serving the
folder over HTTP lets the page POST its result back and keeps the clock real.

Usage: python tools/perf-run.py [label]
"""
import json
import os
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(__file__).resolve().parent.parent
LABEL = sys.argv[1] if len(sys.argv) > 1 else 'run'
PAGE = 'perf-harness-before.html' if LABEL == 'before' else 'perf-harness.html'

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

profile = Path(os.environ['TEMP']) / 'edgeprof-perf'
profile.mkdir(exist_ok=True)

proc = subprocess.Popen(
    [
        EDGE,
        '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
        '--disable-extensions', '--mute-audio',
        f'--user-data-dir={profile}',
        '--window-size=460,900',
        f'http://127.0.0.1:{port}/{PAGE}',
    ],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

if not done.wait(120):
    proc.kill()
    server.shutdown()
    print(f'[{LABEL}] 等不到压测结果（120 秒）')
    sys.exit(1)

proc.kill()
server.shutdown()

data = json.loads(result['body'])
lines = [f'=== {LABEL} ===']
lines.append('启动期间发出的消息: ' + json.dumps(data['boot'], ensure_ascii=False, sort_keys=True))
if 'error' in data:
    lines.append('压测出错: ' + str(data['error']))
if 'diag' in data:
    lines.append('页面状态: ' + json.dumps(data['diag'], ensure_ascii=False, sort_keys=True))
for name, r in data['results'].items():
    lines.append(
        f'{name:20} n={r["n"]:>4}  变更={r["muts"]:>6}'
        f' (封面 {r["art"]:>4} 迷你 {r["mini"]:>4} 歌词 {r["lyric"]:>5})'
        f'  耗时={r["ms"]:>9} ms'
        f'  消息={json.dumps(r["msgs"], ensure_ascii=False, sort_keys=True)}'
    )

out = '\n'.join(lines)
print(out)
(ROOT / f'perf-{LABEL}.txt').write_text(out + '\n', encoding='utf-8')
