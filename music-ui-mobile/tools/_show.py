"""临时小工具：把 ui-check 的结果按关键字过滤出来（cmd 里中文过滤不可靠）。

用法: python tools/_show.py <结果文件> [关键字...]
"""
import io
import sys

path = sys.argv[1]
keys = sys.argv[2:]
lines = io.open(path, encoding='utf-8', errors='replace').read().split('\n')
print('PASS %d / FAIL %d' % (
    sum(1 for l in lines if l.startswith('PASS')),
    sum(1 for l in lines if l.startswith('FAIL')),
))
for l in lines:
    if not keys or any(k in l for k in keys):
        print(l)
