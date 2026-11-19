"""Build a standalone audition page for the desktop.

Takes tools/sfx-check.html and inlines sfx.js into it, so the result is ONE file
you can double-click — no server, no sibling files. Written to the Desktop.

Usage: python tools/make-sfx-audition.py
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'sfx-check.html'
SFX = ROOT / 'sfx.js'
DESKTOP = Path(os.path.join(os.environ['USERPROFILE'], 'Desktop'))
OUT = DESKTOP / '潮汐音效试听.html'

html = SRC.read_text(encoding='utf-8')
sfx = SFX.read_text(encoding='utf-8')

tag = '<script src="../sfx.js"></script>'
if tag not in html:
    raise SystemExit('sfx-check.html 里的 sfx.js 引用变了，先同步这里')

# </script> 出现在代码里会把外层 script 提前关掉，先拆开
inlined = '<script>\n' + sfx.replace('</script>', '<\\/script>') + '\n</script>'
html = html.replace(tag, inlined)

OUT.write_text(html, encoding='utf-8')
print(f'{OUT}  {OUT.stat().st_size // 1024} KB')
