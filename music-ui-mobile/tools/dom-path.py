"""Print the ancestor chain of selected elements in index.html.

A tap that hits the right pixel but does nothing usually means the element is
not where the markup looks like it is. This shows the real nesting.

Usage: python tools/dom-path.py "data-sfx-pack" "scr-set-sfx"
"""
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')


class Walker(HTMLParser):
    def __init__(self, needles):
        super().__init__(convert_charrefs=True)
        self.needles = needles
        self.stack = []
        self.found = {n: [] for n in needles}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        token = tag
        if a.get('id'):
            token += '#' + a['id']
        if a.get('class'):
            token += '.' + a['class'].split()[0]
        self.stack.append(token)
        blob = ' '.join(f'{k}={v}' for k, v in attrs)
        for n in self.needles:
            if n in blob and len(self.found[n]) < 3:
                self.found[n].append(' > '.join(self.stack[-6:]))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i].split('#')[0].split('.')[0] == tag:
                del self.stack[i:]
                return


w = Walker(sys.argv[1:])
w.feed(HTML)
for n in sys.argv[1:]:
    print(f'--- {n} ---')
    for chain in w.found[n]:
        print('  ' + chain)
