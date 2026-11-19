"""List every navigation/action target in index.html so duplicates are visible at a glance.

Usage: python tools/audit-entries.py
"""
import re
from collections import defaultdict
from pathlib import Path

src = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\index.html')
text = src.read_text(encoding='utf-8')

# Each action attribute we care about, plus the visible label right after the button tag.
attr_re = re.compile(r'data-(push|native-page|native-settings|tab-go|play-likes|playlist|toast)="([^"]*)"')

lines = text.splitlines()
# Crude screen tracking: remember which <section id="..."> we're inside.
screen = '(top)'
hits = defaultdict(list)

for i, line in enumerate(lines, 1):
    m = re.search(r'<section[^>]*id="([^"]+)"', line)
    if m:
        screen = m.group(1)
    for attr, val in attr_re.findall(line):
        # Grab a human label: the first text node / title on this line.
        label = ''
        lm = re.search(r'>([^<>{}]{1,24})<', line)
        if lm:
            label = lm.group(1).strip()
        if not label:
            tm = re.search(r'aria-label="([^"]+)"', line)
            label = tm.group(1) if tm else ''
        hits[(attr, val)].append((screen, i, label))

print(f'{src.name}: {len(text)} bytes\n')
for (attr, val), items in sorted(hits.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    dup = '  <<< DUP' if len(items) > 1 else ''
    print(f'data-{attr}="{val}"{dup}')
    for screen, ln, label in items:
        print(f'    {screen:14} line {ln:5}  {label}')
