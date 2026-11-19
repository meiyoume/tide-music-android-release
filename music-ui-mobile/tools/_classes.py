"""把界面里用到的 class 全列出来（重构 CSS 时按这份清单逐项覆盖，别漏）。

用法: python tools/_classes.py
输出：class 名 + 出现次数（index.html 的静态标记 + app.js 里的模板字符串）。
"""
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
text = (ROOT / 'index.html').read_text(encoding='utf-8') + '\n' + \
       (ROOT / 'app.js').read_text(encoding='utf-8')

# class="a b c" / class='...' / class="' + x + '" 里能直接看出来的字面量
names = Counter()
for m in re.finditer(r'class="([^"]*)"', text):
    for tok in m.group(1).split():
        if re.fullmatch(r'[A-Za-z0-9_-]+', tok):
            names[tok] += 1
for m in re.finditer(r"class='([^']*)'", text):
    for tok in m.group(1).split():
        if re.fullmatch(r'[A-Za-z0-9_-]+', tok):
            names[tok] += 1
# classList.add/remove/toggle('x')
for m in re.finditer(r"classList\.(?:add|remove|toggle)\('([A-Za-z0-9_-]+)'", text):
    names[m.group(1)] += 1

for k, v in sorted(names.items()):
    print('%-28s %d' % (k, v))
print('-- 共 %d 个' % len(names))
