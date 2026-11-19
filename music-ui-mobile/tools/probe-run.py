"""Run any probe html under tools/ headlessly and print what it POSTs back.

Usage: python tools/probe-run.py sfx-diag.html [timeout_seconds]
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
PAGE = sys.argv[1] if len(sys.argv) > 1 else 'sfx-diag.html'
TIMEOUT = int(sys.argv[2]) if len(sys.argv) > 2 else 90

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

profile = Path(os.environ['TEMP']) / ('edgeprof-' + PAGE.replace('.', '-'))
profile.mkdir(exist_ok=True)

url = f'http://127.0.0.1:{port}/tools/{PAGE}'
proc = subprocess.Popen(
    [EDGE, '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
     '--autoplay-policy=no-user-gesture-required',
     f'--user-data-dir={profile}', '--window-size=460,900', url],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

ok = done.wait(TIMEOUT)
proc.kill()
server.shutdown()
print(result.get('body', '(没有拿到结果)'))
raise SystemExit(0 if ok else 1)
