"""Rebuild tools/perf-harness.html from index.html.

The harness is index.html plus one extra script (tools/perf-bridge.js) placed
before api.js: it fakes the native bridge so the UI runs the very same code path
the device does, while every postMessage and every DOM mutation can be counted.

Two files come out:
  perf-harness.html         — runs the current app.js            ("after")
  perf-harness-before.html  — runs tools/perf-baseline-app.js    ("before")

so the two benchmark runs differ only in app.js.

Regenerate after editing index.html, then run tools/perf-run.py.

Usage: python tools/make-perf-harness.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'index.html'

# 必须插在 api.js 之前：api.js 一看 window.ReactNativeWebView 在不在就定后端，
# 插在它后面的话界面会静默地退回演示后端，什么都量不到。
ANCHOR = '<script src="api.js'

html = SRC.read_text(encoding='utf-8')
idx = html.find(ANCHOR)
if idx < 0:
    raise SystemExit('找不到 api.js 的 script 标签，index.html 结构变了？')

html = html[:idx] + '<script src="tools/perf-bridge.js"></script>\n' + html[idx:]

out = ROOT / 'perf-harness.html'
out.write_text(html, encoding='utf-8')
print(f'{out.name}  {out.stat().st_size} 字节')

# 优化前那一版 app.js（tools/perf-baseline-app.js）留着一份，好把「优化前」也能量一遍
baseline = ROOT / 'tools' / 'perf-baseline-app.js'
if baseline.exists():
    before = re.sub(r'<script src="sfx\.js[^"]*"></script>\n', '', html)
    before = before.replace('<script src="app.js', '<script src="tools/perf-baseline-app.js')
    out2 = ROOT / 'perf-harness-before.html'
    out2.write_text(before, encoding='utf-8')
    print(f'{out2.name}  {out2.stat().st_size} 字节')
