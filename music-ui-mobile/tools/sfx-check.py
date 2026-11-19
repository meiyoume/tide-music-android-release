"""Render every sound effect offline and print what the waveform looks like.

The page (tools/sfx-check.html) renders each pack x event through an
OfflineAudioContext and measures the resulting PCM: peak, RMS, tail length and
a zero-crossing brightness proxy. That is evidence the sounds are actually
audible and unclipped, rather than just "the function got called".

Usage: python tools/sfx-check.py
"""
import os
import subprocess
import sys
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
        body = self.rfile.read(n).decode('utf-8', 'replace')
        result['body'] = body
        self.send_response(204)
        self.end_headers()
        # 页面会先报一句「已加载」，那不是结果，继续等
        if not body.startswith('页面已加载'):
            done.set()

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

profile = Path(os.environ['TEMP']) / 'edgeprof-sfx'
profile.mkdir(exist_ok=True)

proc = subprocess.Popen(
    [
        EDGE,
        '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
        f'--user-data-dir={profile}',
        '--window-size=900,1200',
        f'http://127.0.0.1:{port}/tools/sfx-check.html?check=1',
    ],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

if not done.wait(120):
    proc.kill()
    server.shutdown()
    print('等不到校验结果（120 秒）')
    sys.exit(1)

proc.kill()
server.shutdown()

print(result['body'])
(ROOT / 'sfx-check.txt').write_text(result['body'] + '\n', encoding='utf-8')
