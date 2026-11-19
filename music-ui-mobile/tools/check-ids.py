"""Cross-check that every element id app.js looks up still exists in index.html.

Deleting markup without deleting the matching JS binding is how you get a silent
boot() crash (the whole UI renders its static skeleton but no data). This catches
that class of mistake.

Usage: python tools/check-ids.py
"""
import re
import sys
from pathlib import Path

root = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
html = (root / 'index.html').read_text(encoding='utf-8')
appjs = (root / 'app.js').read_text(encoding='utf-8')
apijs = (root / 'api.js').read_text(encoding='utf-8')

have = set(re.findall(r'\bid="([^"]+)"', html))

# Also allow ids created at runtime by JS (innerHTML templates).
created = set(re.findall(r'id="([^"]+)"', appjs)) | set(re.findall(r'id="([^"]+)"', apijs))

missing = []
for src_name, src in (('app.js', appjs), ('api.js', apijs)):
    for m in re.finditer(r'''\$\('#([A-Za-z][\w-]*)'\)|getElementById\('([A-Za-z][\w-]*)'\)''', src):
        ref = m.group(1) or m.group(2)
        line = src[:m.start()].count('\n') + 1
        if ref not in have and ref not in created:
            missing.append((src_name, line, ref))

print(f'index.html defines {len(have)} ids')
bad = list(missing)

# data-push points at a screen id; if that screen was deleted the button silently
# does nothing (pushSub bails when getElementById returns null).
for m in re.finditer(r'data-push="([^"]+)"', html):
    line = html[:m.start()].count('\n') + 1
    if m.group(1) not in have:
        bad.append(('index.html', line, 'data-push -> #' + m.group(1)))

# data-tab-go points at a tab screen id built as scr-<name>.
for m in re.finditer(r'data-tab-go="([^"]+)"', html):
    line = html[:m.start()].count('\n') + 1
    if 'scr-' + m.group(1) not in have:
        bad.append(('index.html', line, 'data-tab-go -> #scr-' + m.group(1)))

if bad:
    print(f'\n{len(bad)} broken reference(s):')
    for src_name, line, ref in bad:
        print(f'  {src_name}:{line}  {ref}')
    sys.exit(1)
print('\nall lookups and entry points resolve')
