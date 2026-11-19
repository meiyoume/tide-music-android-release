"""Remove whole <section id="..."> blocks (plus a preceding comment line and the blank line after)
from index.html.

Usage: python tools/remove-sections.py scr-set-playback scr-set-download scr-set-storage

Written as a script rather than hand-editing because the blocks are ~80 lines each and
copy-pasting markup into an editor is where mistakes creep in.
"""
import re
import sys
from pathlib import Path

src = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\index.html')
lines = src.read_text(encoding='utf-8').splitlines(keepends=True)

targets = sys.argv[1:]
if not targets:
    raise SystemExit('pass one or more section ids')

for target in targets:
    start = None
    for i, line in enumerate(lines):
        if re.search(r'<section[^>]*id="%s"' % re.escape(target), line):
            start = i
            break
    if start is None:
        raise SystemExit('section not found: ' + target)

    # Include a directly preceding comment line (and its blank separator) with the block.
    begin = start
    if begin > 0 and lines[begin - 1].lstrip().startswith('<!--'):
        begin -= 1
        if begin > 0 and lines[begin - 1].strip() == '':
            begin -= 1

    end = None
    for j in range(start + 1, len(lines)):
        if lines[j].strip() == '</section>':
            end = j
            break
    if end is None:
        raise SystemExit('closing </section> not found for ' + target)

    # Swallow one trailing blank line so we do not leave double gaps.
    stop = end + 1
    if stop < len(lines) and lines[stop].strip() == '':
        stop += 1

    print(f'{target}: removing lines {begin + 1}..{stop} ({stop - begin} lines)')
    del lines[begin:stop]

src.write_text(''.join(lines), encoding='utf-8', newline='')
print('written:', src)
