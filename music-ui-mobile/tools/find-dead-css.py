"""Report which CSS classes are still referenced by index.html.

Used after deleting pages, to find CSS that is now dead. Reads class names out of
styles.css, then counts their occurrences in index.html (as class tokens).

Usage: python tools/find-dead-css.py
"""
import re
from pathlib import Path

root = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile')
css = (root / 'styles.css').read_text(encoding='utf-8')
html = (root / 'index.html').read_text(encoding='utf-8')
js = (root / 'app.js').read_text(encoding='utf-8')

# Collect class tokens from CSS selectors (only simple .name tokens).
names = set()
for m in re.finditer(r'\.([A-Za-z][\w-]*)', css):
    name = m.group(1)
    if name.startswith('icon--') or name.startswith('cover--'):  # generated, ignore
        continue
    names.add(name)

used_in_html = set()
for m in re.finditer(r'class="([^"]*)"', html):
    used_in_html.update(m.group(1).split())

# JS may build markup with these class names in strings.
dead = []
for n in sorted(names):
    if n in used_in_html:
        continue
    if re.search(r'[\'"]' + re.escape(n) + r'[\'"]', js):
        continue
    # also catch templates like 'cover cover--' + key
    if n in js:
        continue
    dead.append(n)

print(f'{len(names)} class names in CSS; {len(dead)} look unused:\n')
for n in dead:
    print('  ', n)
