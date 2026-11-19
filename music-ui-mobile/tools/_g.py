"""小工具：在某个文件里按正则找行（cmd 里 findstr 的中文/引号很容易被拆坏）。

用法:
  python tools/_g.py <正则> [文件或目录] [扩展名逗号分隔]
"""
import os
import re
import sys

pat = re.compile(sys.argv[1])
root = sys.argv[2] if len(sys.argv) > 2 else '.'
exts = tuple((sys.argv[3] if len(sys.argv) > 3 else '.ts,.tsx').split(','))
n = 0


def scan(p):
    global n
    try:
        lines = open(p, encoding='utf-8', errors='replace').read().split('\n')
    except OSError:
        return
    for i, l in enumerate(lines):
        if pat.search(l):
            print('%s:%d: %s' % (p.replace('\\', '/'), i + 1, l.strip()[:160]))
            n += 1


if os.path.isfile(root):
    scan(root)
else:
    for r, _d, fs in os.walk(root):
        for f in sorted(fs):
            if f.endswith(exts):
                scan(os.path.join(r, f))
print('-- %d 行' % n)
