"""Run tools/click-probe.html headlessly and print what it reported.

Usage: python tools/click-probe.py '[data-sfx-pack="wood"]'
"""
import os
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
ROOT = Path(__file__).resolve().parent.parent
SEL = sys.argv[1] if len(sys.argv) > 1 else '[data-sfx-pack="wood"]'

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

profile = Path(os.environ['TEMP']) / 'edgeprof-probe'
profile.mkdir(exist_ok=True)

url = f'http://127.0.0.1:{port}/tools/click-probe.html?sel={quote(SEL)}'
proc = subprocess.Popen(
    [EDGE, '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
     f'--user-data-dir={profile}', '--window-size=460,900', url],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

if not done.wait(60):
    proc.kill()
    server.shutdown()
    print('等不到探测结果')
    sys.exit(1)

proc.kill()
server.shutdown()
print(result['body'])
