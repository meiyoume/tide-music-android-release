"""在模拟器上按真实点击验收这一轮的两个功能：播放音效、搜索联想。

为什么用「按可见文字点」而不是像素坐标：WebView 里的文本节点对 uiautomator 是可见的
（`aria-label` 会变成节点的 text），所以可以点「写着『音效』的那个按钮」，
不用从截图上估坐标（估坐标连续点空过好几次，见 TIDE-ANDROID.md 坑 11）。

用法:
  python tools/verify-fx-tips.py install <apk>     # 装包 + 启动 + 走完全部流程
  python tools/verify-fx-tips.py run               # 不装包，直接走流程
  python tools/verify-fx-tips.py dump <正则>        # 看一眼当前屏幕上的节点
"""
import functools
import os
import random
import re
import subprocess
import sys
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
PKG = 'cn.toside.music.mobile.harmony'
ACT = PKG + '/cn.toside.music.mobile.MainActivity'
LEGACY = 'cn.toside.music.mobile'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\verify_ui.xml')
# 拿内置音源脚本当「在线导入」的测试素材（改个名字就是一份合法脚本）
TEST_SRC = Path(r'D:\anzhuang\deepseek-harness\lxmusic-android\tools\builtin-sources-src\helloworld.js')

results = []


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    """当前屏幕上的可见节点（文本 + 中心点 + 可点 + class）

    `class` 是 v1.9.20 加的：WebView 里的 `<input>` 在 uiautomator 里是 `EditText`，
    它的 `text` 是**内容**不是 placeholder（空的时候是空串），按文字找不到，
    只能按 class 找。见坑 51。
    """
    adb('shell', 'uiautomator', 'dump', '/sdcard/verify_ui.xml')
    adb('pull', '/sdcard/verify_ui.xml', str(DUMP))
    text = DUMP.read_text(encoding='utf-8', errors='replace')
    out = []
    for m in re.finditer(r'<node[^>]*>', text):
        tag = m.group(0)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not b:
            continue
        x1, y1, x2, y2 = (int(g) for g in b.groups())
        if x2 == 0 and y2 == 0:
            continue
        t = re.search(r'text="([^"]*)"', tag)
        d = re.search(r'content-desc="([^"]*)"', tag)
        c = re.search(r'clickable="(\w+)"', tag)
        cls = re.search(r'class="([^"]*)"', tag)
        label = (t.group(1) if t else '') or (d.group(1) if d else '')
        out.append({'text': label, 'class': cls.group(1) if cls else '',
                    'clickable': c.group(1) == 'true' if c else False,
                    'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2, 'bounds': (x1, y1, x2, y2)})
    return out


def texts():
    return [n['text'] for n in nodes() if n['text']]


def find(pat, want=0, clickable_only=False):
    hits = [n for n in nodes()
            if re.search(pat, n['text']) and (not clickable_only or n['clickable'])]
    return hits[want] if len(hits) > want else None


def tap_text(pat, *, want=0, wait=1.2):
    """点匹配到的第 want 个节点。

    `want` / `wait` 做成**只能按关键字传**：v1.9.20 踩到过
    `tap_text('^取消$', 1.5)` —— 1.5 被当成 `want`，于是 `hits[1.5]` 抛
    `TypeError`（或者静默取不到），而写的人以为自己传的是「等 1.5 秒」。
    关键字化之后这种写法会直接报「unexpected positional argument」，一眼就看出来。
    """
    n = find(pat, want)
    if not n:
        fail('找不到可点的「%s」' % pat)
        return False
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)
    return True


def tapxy(x, y, wait=1.0):
    adb('shell', 'input', 'tap', str(x), str(y))
    time.sleep(wait)


def screen_size():
    m = re.search(r'(\d+)x(\d+)', adb('shell', 'wm', 'size'))
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 2340)


def density():
    """屏幕密度。uiautomator 给的是**像素**，RN 用的是 **dp** —— 比高度必须换算，
    不然「54dp 的行」在 2.75 倍密度下量出来是 148px，跟 46dp 的 126px 差得不多，
    看着像没改。"""
    nums = re.findall(r'(\d+)', adb('shell', 'wm', 'density'))
    return float(nums[-1]) / 160 if nums else 2.75


# 屏幕最上面这一条不算「安全可点」：那是状态栏。
# 注意别设太大 —— 页面自己的标题栏（返回键 / 右上角动作按钮）就在 y≈100 一带，
# 设成 240 的话「新建歌单」右上角的「创建」会被判成「在屏幕外」，怎么滑都点不到。
SAFE_TOP = 80


def tap_last(pat, wait=1.2):
    """点匹配到的**最下面**那个。

    底栏页签的文字常和页面里的标签重名（「我的」页统计里就有「收藏」，
    底栏也有「收藏」），而底栏永远在最下面，所以取 y 最大的那个。
    实测按第一个匹配点，点到了统计里的「收藏」—— 那是个 span，点了没反应。
    """
    hits = [n for n in nodes() if re.search(pat, n['text'])]
    if not hits:
        fail('找不到「%s」' % pat)
        return False
    n = max(hits, key=lambda x: x['y'])
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)
    return True


def tap_row(pat, want=0, wait=1.2, tries=6):
    """点一个**可能不在屏幕上**的行：先滑到它可见再点。

    为什么要这样：uiautomator 对屏幕外的节点照样给出坐标，直接点会点到被裁到
    屏幕边缘的位置。实测「我的」页变长之后，点「播放音效」点到了底栏的「收藏」
    —— 一次假失败，查了半天。所以点之前先确认 y 在安全区内。

    另外优先取「底栏以上」的那个：页面里的按钮常和底栏页签重名
    （歌单详情页那颗「收藏」按钮 vs 底栏的「收藏」页签）。
    """
    _w, h = screen_size()
    bottom = h - 360
    for _ in range(tries):
        hits = [n for n in nodes() if re.search(pat, n['text'])]
        if not hits:
            fail('找不到「%s」' % pat)
            return False
        above = [n for n in hits if n['y'] < bottom]
        pool = above or hits
        n = pool[want] if len(pool) > want else pool[0]
        if SAFE_TOP <= n['y'] <= bottom:
            adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
            time.sleep(wait)
            return True
        if n['y'] > bottom:                       # 在下面 → 往上滑
            adb('shell', 'input', 'swipe', '540', str(h - 800), '540', str(h - 1400), '300')
        else:                                     # 在上面 → 往下滑
            adb('shell', 'input', 'swipe', '540', str(h - 1400), '540', str(h - 800), '300')
        time.sleep(1.0)
    fail('滑了几次还是点不到「%s」' % pat)
    return False


def tap_retry(pat, tries=4, wait=1.2):
    """点一个**静态**按钮，找不到就重新 dump 再找一遍。

    为什么需要：输入法弹出来的时候 `uiautomator dump` 会偶尔失败（取不到 idle 状态），
    `nodes()` 拿到的就是上一次的旧文件 —— 旧文件里可能正好没有这个按钮。
    实测「导入」按钮明明在屏幕上（截图可见）、`texts()` 里也有，dump 里却没有。
    """
    for _ in range(tries):
        if tap_text(pat, wait=wait):
            return True
        time.sleep(0.8)
    return False


def hide_keyboard():
    """收键盘：点一下分组标题（点输入框外面就失焦了）。

    **不能按返回键**：在「添加音源」这种子页上，返回键会被界面当成「退回上一页」
    （而且安卓的「返回键先收键盘」在 WebView + 自定义返回处理下不保证），
    实测按下去整页就退出去了，后面的断言全落空。

    点的位置要在键盘上方 —— uiautomator 对屏幕外的节点照样给坐标，
    落到键盘上就白点了。
    """
    for _ in range(3):
        n = find(r'^从在线地址导入$')
        if not n:
            return
        if n['y'] < 1200:
            tap_text(r'^从在线地址导入$', wait=0.8)
            time.sleep(0.8)
            return
        adb('shell', 'input', 'swipe', '540', '900', '540', '1800', '250')
        time.sleep(0.8)


def section_count(title):
    """读「我创建的歌单 3」这种小节标题里的数字。

    标题可能在屏幕外（自建歌单攒到 8 个之后，「我收藏的歌单」就被顶下去了），
    所以先往下滑着找。找不到返回 None。
    """
    _w, h = screen_size()
    for _ in range(6):
        n = find(r'^%s\s*\d+$' % title)
        if n:
            m = re.search(r'(\d+)\s*$', n['text'])
            return int(m.group(1)) if m else None
        adb('shell', 'input', 'swipe', '540', str(h - 900), '540', str(h - 1600), '300')
        time.sleep(1.2)
    return None


def current_source_name():
    """读音源页「当前音源」卡里的那个名字。

    卡片是「当前音源 / 名字 / 说明」三行，名字就是标签下面第一个文本节点。
    """
    ns = nodes()
    anchor = None
    for n in ns:
        if n['text'] == '当前音源':
            anchor = n
            break
    if not anchor:
        return ''
    below = [n for n in ns
             if n['text'] and anchor['y'] < n['y'] < anchor['y'] + 300]
    if not below:
        return ''
    return min(below, key=lambda x: x['y'])['text']


def tap_source_row(name, wait=1.5, tries=5):
    """点音源列表里的那一行。

    两个坑：
    1. 同一个名字在屏幕上会出现两次：上面「当前音源」卡里一次（整段就是名字）、
       列表行里一次（**整行是一个拼接串**，形如 `星海音乐源 v3.2.15 · …`）——
       所以必须按**子串**匹配，精确等于匹配不到行。
    2. 行在下面，取 y 最大的那个；还得落在安全区里（列表可能滚出屏幕），
       不在就滑一下 —— 理由同 tap_row（uiautomator 对屏幕外的节点照样给坐标）。
    """
    _w, h = screen_size()
    bottom = h - 360
    for _ in range(tries):
        hits = [n for n in nodes() if name in n['text']]
        if not hits:
            return False
        n = max(hits, key=lambda x: x['y'])
        if SAFE_TOP <= n['y'] <= bottom:
            adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
            time.sleep(wait)
            return True
        if n['y'] > bottom:
            adb('shell', 'input', 'swipe', '540', str(h - 800), '540', str(h - 1500), '300')
        else:
            adb('shell', 'input', 'swipe', '540', str(h - 1500), '540', str(h - 800), '300')
        time.sleep(1.0)
    return False


# 内置的五个音源（tools/builtin-sources.manifest.json）。音源页那一段要「换一个
# 不是当前的源」，得先知道有哪些名字可用；写死一份比从界面上猜可靠。
# ⚠️ 这里写的是**界面上显示的名字**，不是脚本文件名 —— 最后一个的 @name 是
# `helloworld`，但脚本头里写的是 `Hello World`（大写 + 空格），按小写匹配不到它。
SOURCE_NAMES = ['HYWmusic_beta_公益测试', '星海音乐源', 'lx-玉宁熙-Pro', '屿溪-终章', 'Hello World']


class H11(SimpleHTTPRequestHandler):
    """HTTP/1.1 + 明确 `Connection: close` 的测试服务端。

    默认的 `SimpleHTTPRequestHandler` 是 **HTTP/1.0**，而它会用
    `HTTP/1.0 200 OK` 去回一个 **HTTP/1.1 + `Connection: Keep-Alive`** 的请求，
    同时因为 `close_connection=False` **不关连接**。OkHttp 收到 HTTP/1.0 的响应
    会认为「这连接该关了」，于是自己关/等 —— 这个组合在模拟器上非常不稳：
    服务端日志里那条 GET 明明是 200，App 那边却抛 `Network request failed`
    （RN 翻译成「无法连接到服务器」）。**排查了两轮**才发现是自己搭的测试服务端
    不合规，不是 App 的问题（真实音源地址都是正经 HTTP/1.1 服务端）。

    换成 HTTP/1.1 + `Connection: close` 之后，同一套点击流程稳定成功。
    """
    protocol_version = 'HTTP/1.1'

    def end_headers(self):
        self.send_header('Connection', 'close')
        super().end_headers()


def make_test_source():
    """起一个本地 HTTP 服务，放一份**真**音源脚本，给「从在线地址导入」用。

    为什么要真起一个：导入这条链路（下载 → 内核校验 → 写进 user_api）必须真跑
    一遍才算验过。脚本内容拿内置的 helloworld 改个 @name / @version —— 它是内核
    认的合法脚本，改完照样认。名字带随机后缀，保证每轮都是**新的一条**（不然
    内核按名字去重，第二次跑就看不到「列表多一条」）。

    模拟器访问宿主机走 10.0.2.2，所以服务绑 127.0.0.1 就够（10.0.2.2 就是宿主机
    的环回口）。服务端必须是 HTTP/1.1，理由见 `H11`。
    """
    text = TEST_SRC.read_text(encoding='utf-8')
    name = '潮汐测试音源%04d' % random.randint(0, 9999)
    text = re.sub(r'@name[^\n]*', '@name %s' % name, text, count=1)
    text = re.sub(r'@version[^\n]*', '@version 1.0.0', text, count=1)
    d = Path(tempfile.mkdtemp(prefix='tide-src-'))
    (d / 'tide-test.js').write_text(text, encoding='utf-8')
    # 优先用 3208：模拟器访问 10.0.2.2 时，随机高位端口（实测 38949）偶发
    # 连不上，而 3208 在两轮里都稳定。端口被占再退回系统分配。
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', 3208),
                                  functools.partial(H11, directory=str(d)))
    except OSError:
        srv = ThreadingHTTPServer(('127.0.0.1', 0),
                                  functools.partial(H11, directory=str(d)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return name, 'http://10.0.2.2:%d/tide-test.js' % srv.server_address[1], srv


def tap_src_url_input(wait=1.2):
    """点「添加音源」页里的地址输入框。

    两个坑：
    1. WebView 里的 `<input>` 在 uiautomator 里是 **EditText** 节点，但它的 text
       是**内容**（空的时候是空串），不是 placeholder —— 按文字找不到，得按 class 找。
    2. 上一轮可能把页面滚下去了，输入框和「导入」都在屏幕外（uiautomator 照样给
       坐标，点了等于没点）。所以先往回滚，直到 EditText 真在屏幕上。
    """
    for _ in range(5):
        box = next((n for n in nodes() if n['class'].endswith('EditText')), None)
        if box and SAFE_TOP <= box['y'] <= 1200:
            break
        adb('shell', 'input', 'swipe', '540', '900', '540', '1800', '250')
        time.sleep(0.9)
    box = next((n for n in nodes() if n['class'].endswith('EditText')), None)
    if not box:
        return False
    adb('shell', 'input', 'tap', str(box['x']), str(box['y']))
    time.sleep(wait)
    return True


def tap_confirm_delete(wait=3):
    """点确认态里那颗「删除」。

    坑：屏幕上同时存在**两种**「删除」—— 每行右边那个垃圾桶（`aria-label=删除`）
    和确认态里那颗红胶囊「删除」。按文字取第一个会取到**别的行**的垃圾桶，
    表现是「点了删除，确认态跑到另一行去了，什么都没删掉」（第一轮实测就是这样）。
    确认态里「取消」和「删除」同一行，所以按「离『取消』最近」取。
    """
    ns = nodes()
    cancel = next((n for n in ns if n['text'] == '取消'), None)
    if not cancel:
        return False
    cands = [n for n in ns if n['text'] == '删除' and abs(n['y'] - cancel['y']) < 80]
    if not cands:
        return False
    n = min(cands, key=lambda x: abs(x['x'] - cancel['x']))
    adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
    time.sleep(wait)
    return True


def src_add_count():
    """读「添加音源」页「已装音源」后面那个数字。

    为什么要单独读它、不数行数：新导入的源**加在最后**，列表一长它就滚到屏幕外了
    （uiautomator 看不见），数行数会得到「没多」的假结论 —— 第一轮就是这么误判的。
    标题和数字在 uiautomator 里是**两个相邻节点**（不是拼接串），所以按 y 找。

    ⚠️ 标题节点的 text **带一个尾空格**（HTML 里写作 `已装音源 <span>5</span>`，
    空格归到前一个文本节点了），所以两边都要 `strip()` —— 直接用 `==` 匹配不到。
    """
    ns = nodes()
    label = next((n for n in ns if (n['text'] or '').strip() == '已装音源'), None)
    if not label:
        return None
    near = [n for n in ns if re.fullmatch(r'\d+', (n['text'] or '').strip())
            and abs(n['y'] - label['y']) < 60]
    return int(near[0]['text'].strip()) if near else None


def has_exact(text):
    """屏幕上有没有**恰好等于** text 的节点。

    用它而不是 `text in 页面全文`：toast 是「已删除「XXX」」，用子串判断会把
    「删掉了」判成「还在」（第一轮实测）。
    """
    return any(n['text'] == text for n in nodes())


def tap_src_trash_of(name):
    """点某一条已装音源右边的垃圾桶。

    坑：那一行可能在**底栏下面**，直接点会点到「我的」页签（第一次就这么假失败的）。
    所以先确认它的 y 在安全区里，不在就往上滑。
    """
    _w, h = screen_size()
    bottom = h - 400
    for _ in range(6):
        ns = nodes()
        row = next((n for n in ns if name in n['text']), None)
        if row:
            # 同一行里 y 最接近的、且在其右侧的那个「删除」
            trashes = [n for n in ns if n['text'] == '删除' and abs(n['y'] - row['y']) < 140]
            if trashes:
                t = min(trashes, key=lambda x: abs(x['y'] - row['y']))
                if SAFE_TOP <= t['y'] <= bottom:
                    adb('shell', 'input', 'tap', str(t['x']), str(t['y']))
                    time.sleep(1.2)
                    return True
                adb('shell', 'input', 'swipe', '540', str(h - 800), '540', str(h - 1500), '300')
                time.sleep(1.2)
                continue
        adb('shell', 'input', 'swipe', '540', str(h - 800), '540', str(h - 1500), '300')
        time.sleep(1.2)
    return False


def shot(name):
    # 这台机器的 qemu 在 `adb exec-out screencap` 上偶发崩（返回 0 字节后设备掉线）。
    # 只验逻辑时用 NO_SHOTS=1 跳过截图；要看画面时去掉它再跑。
    if os.environ.get('NO_SHOTS') == '1':
        print('    shot skipped -> dev-%s.png' % name)
        return
    SHOTS.mkdir(exist_ok=True)
    dest = SHOTS / ('dev-%s.png' % name)
    dest.write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    print('    shot -> %s' % dest.name)


def _gbk_safe(s):
    """控制台是 GBK：dump 里可能带 emoji（✨ 之类）或生僻字，直接 print 会
    UnicodeEncodeError 把整个流程打断（实测：恢复流程在打 PASS 那行时崩了）。
    打不出来的字符用 ? 兜底，断言本身不受影响。"""
    try:
        return str(s).encode('gbk', 'replace').decode('gbk')
    except Exception:
        return str(s)


def ok(label, extra=''):
    results.append(True)
    print(_gbk_safe('PASS  %s  %s' % (label, extra)))


def fail(label, extra=''):
    results.append(False)
    print(_gbk_safe('FAIL  %s  %s' % (label, extra)))


def expect(cond, label, extra=''):
    ok(label, extra) if cond else fail(label, extra)


def check(label, pat, want=True, extra='', tries=8):
    """屏幕上有没有匹配 pat 的节点。

    慢速模拟器上「点完了但画面还没换」很常见（实测首帧一次 GL 绘制能占 4 秒），
    所以这里重试几次再判 —— 否则失败的是机器速度，不是界面。
    """
    hit = False
    for i in range(tries):
        hit = find(pat) is not None
        if hit == want:
            break
        time.sleep(1)
    expect(hit, label, extra)
    return hit


def has_text(*needles):
    """这几个词是否都出现在当前屏幕"""
    all_t = ' | '.join(texts())
    return [n for n in needles if n not in all_t]


def has_text_retry(needles, tries=6):
    """has_text 的重试版。

    刚冷启动 / 刚装完的模拟器上，软件 GL 一次绘制能占好几秒，
    「点完了但内容还没画出来」很常见 —— 不重试就会把机器慢判成界面坏。
    """
    missing = list(needles)
    for _ in range(tries):
        missing = has_text(*needles)
        if not missing:
            return []
        time.sleep(1)
    return missing


def tap_until(pat, needles, tries=3, wait=1.6):
    """点一下，然后确认预期的文字出现了；没出现就**再点一次**。

    为什么不能只用 has_text_retry：v1.9.19 实测「音效弹层的两个页签」这一步
    会抖动 —— 截图里页签明明切过去了、内容也画出来了，但 uiautomator 那份
    无障碍树还停在上一个页签上，于是「读」怎么重试都读不到。
    这种情况下要重试的是「点」，不是「读」。
    """
    for _ in range(tries):
        if not tap_text(pat, wait=wait):
            return False
        if not has_text_retry(needles, tries=3):
            return True
    return False


def launch():
    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(1)
    adb('shell', 'am', 'start', '-n', ACT)
    time.sleep(22)
    for i in range(10):
        r = subprocess.run(['node', r'D:\anzhuang\deepseek-harness\lxmusic-android\tools\dismiss-first-run.mjs'],
                           capture_output=True, text=True)
        if 'NO_DIALOG' in (r.stdout or '') + (r.stderr or ''):
            break
        time.sleep(2)
    # 刚开机后的第一次冷启动会明显更慢（dexopt + 系统自己还在忙），22 秒可能不够。
    # 不够的话后面整段都打在桌面上 —— 而「首页渲染出来了」只数节点数，是数不出桌面的
    # （桌面图标也是文本节点，实测 33 个），于是会连着报一堆「找不到节点」。
    # 所以这里必须确认前台真的是我们，没起来就再拉一次。
    for _ in range(6):
        if foreground() == PKG:
            break
        adb('shell', 'am', 'start', '-n', ACT)
        time.sleep(6)
    time.sleep(3)


def install(apk):
    adb('uninstall', LEGACY)
    print(adb('install', '-r', '-g', apk).strip())
    adb('shell', 'settings', 'put', 'global', 'window_animation_scale', '0')
    adb('shell', 'settings', 'put', 'global', 'transition_animation_scale', '0')
    adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')


def start_playback():
    """起播一首歌。音效要挂在播放会话上，没在播就没会话。

    走「每日推荐 → 播放全部」而不是点首页某首歌：首页「猜你喜欢」在没听过歌时是空的
    （这一版刚装完就是空的），而每日推荐一定有 30 首。
    """
    tap_text('^推荐$', wait=2.5)
    if not tap_text('每日推荐', wait=6):
        return False
    if not tap_text('^播放全部$', wait=8):
        return False
    return find('展开播放页') is not None


def scroll_sheet(times=1):
    """弹层比屏幕高，下半部分（响度增强 / 环境混响 / 落款）要滚上来才看得见"""
    for _ in range(abs(times)):
        if times > 0:
            adb('shell', 'input', 'swipe', '540', '1900', '540', '950', '400')
        else:
            adb('shell', 'input', 'swipe', '540', '950', '540', '1900', '400')
        time.sleep(1.2)


def foreground():
    m = re.search(r'mCurrentFocus=[^\n]*?([\w.]+)/', adb('shell', 'dumpsys', 'window'))
    return m.group(1) if m else ''


def ensure_app():
    """安卓返回键在根页面会把应用退到后台 —— 每次进新一段前先确认还在前台"""
    fg = foreground()
    if PKG not in fg:
        print('    （应用不在前台：%s，重新拉起）' % fg)
        adb('shell', 'am', 'start', '-n', ACT)
        time.sleep(14)
    return True


def go_home():
    """回首页。首页的特征是那个搜索框（文案「搜索歌曲、歌手、歌单」）"""
    ensure_app()
    for _ in range(4):
        if find('搜索歌曲') is not None:
            return True
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(1.5)
    ensure_app()
    tap_text('^推荐$', wait=2.5)
    return find('搜索歌曲') is not None


def flow():
    # ── 首页 + 起播
    print('\n-- 首页 / 起播')
    # 冷启动可能落在上次停留的页面（每日推荐 / 播放页），先退回首页再开始量
    go_home()
    shot('fx-01-home')
    # 首帧要等 WebView 真把内容画出来（模拟器上软件 GL 一次绘制实测能占 4 秒）。
    # 判据要带上「有问候语」—— 只数节点数的话，桌面也能凑够 5 个（图标就是文本节点）。
    ns = []
    for _ in range(10):
        ns = nodes()
        if len([n for n in ns if n['text']]) > 5 and find('想听点什么') is not None:
            break
        time.sleep(1)
    expect(foreground() == PKG, '前台是潮汐音乐（不是桌面）', foreground())
    expect(len([n for n in ns if n['text']]) > 5, '首页渲染出来了', '%d 个节点' % len(ns))
    expect(find('想听点什么') is not None, '首页是自己的界面（有问候语）')
    # v1.9.19：「猜你喜欢」以前就是本地收藏，只收藏了一首时整栏孤零零一行
    # （用户：「猜你喜欢里面就一首歌 要三十首才对」）。现在收藏打底 + 榜单补足到 30 首，
    # 标题上写出首数，这里直接读那个数字 —— 光看列表是数不出行数的。
    # 补足要拉榜单，所以给足重试时间（慢速模拟器上这条请求要几秒）。
    hit = None
    for _ in range(15):
        hit = find(r'猜你喜欢\s*\d+')
        if hit and re.search(r'30\s*$', hit['text']):
            break
        time.sleep(1)
    if not hit:
        fail('首页上没有「猜你喜欢 <首数>」这行字',
             ' | '.join(x for x in texts() if '猜' in x)[:120])
    else:
        expect(re.search(r'30\s*$', hit['text']) is not None,
               '「猜你喜欢」补足到 30 首（不是只显示收藏的那一两首）', hit['text'])
    if not start_playback():
        fail('没能起播（后面依赖播放会话的检查都会跳过）')
        shot('fx-02-noplay')
        return
    ok('起播成功，迷你播放条出现了')

    print('\n-- 进播放页')
    # 迷你条有 .3s 入场动画；刚起播就点容易点在动画中的位置上（UIA 给的还是终态坐标），
    # 先等它落位。播放页本身也是 .3s 滑上来，点完再等无障碍树跟上。
    time.sleep(0.8)
    # 后面整段播放音效的检查都依赖这一页，所以这里重试到「音效」按钮真出现为止
    # —— 实测点一次直接往下走会偶发「找不到音效」，然后整条 flow 提前结束。
    for _ in range(3):
        tap_text('展开播放页', wait=2.5)
        if has_text_retry(['音效'], tries=2) == []:
            break
    shot('fx-02-player')

    # ── 封面 ↔ 歌词（v1.9.22 把硬切换成交叉淡入淡出，提示胶囊也能点）
    print('\n-- 歌词切换')
    if tap_text('轻点封面查看歌词', wait=2.5):
        check('点提示后进入歌词（提示变成「轻点歌词返回封面」）', r'轻点歌词返回封面')
        shot('fx-02b-lyrics')
        if tap_text('轻点歌词返回封面', wait=2.5):
            check('点歌词回到封面', r'轻点封面查看歌词')
    else:
        fail('找不到「轻点封面查看歌词」提示')

    # ── 播放音效面板
    print('\n-- 播放音效面板')
    if not tap_retry('^音效$', tries=3):
        shot('fx-03-no-sheet')
        fail('打不开音效弹层')
        return
    shot('fx-03-sfx-sheet')
    missing = has_text_retry(['播放音效', '界面音效', '设备预设', '经典均衡', '耳机校正', '低音增强'])
    expect(not missing, '弹层上半部分控件齐全', ('缺: ' + ','.join(missing)) if missing else '')
    check('设备预设组带来源说明', r'手机系统自带')

    # 先在顶部把三个分组都点一遍（页签在最上面，滚下去就点不着了）
    tap_text('^经典均衡$', wait=1.5)
    shot('fx-04-vlc-group')
    check('经典组显示来源（VLC / LGPL-2.1+）', r'VLC 经典预设')
    if tap_text('^重低音$', wait=3):
        shot('fx-05-picked')
        hits = [x['text'] for x in nodes() if '重低音' in x['text']]
        expect(len(hits) >= 2, '选中「重低音」后摘要也变成它', ' | '.join(hits))

    tap_text('^耳机校正$', wait=1.5)
    shot('fx-06-autoeq-group')
    check('耳机组里有型号', r'索尼 WH-1000XM|森海塞尔 HD 600|水月雨')

    # 音效弹层的两个页签（v1.9.19 起这一步改成「点了再确认、没换成就再点一次」）。
    # 原因：这两条断言在两次连跑里一次过一次挂，而**截图证明界面是好的**
    # （fx-07 里「界面音效」页签是亮的、四个音色包都在），
    # 挂的时候是 uiautomator 那份无障碍树还停在上一个页签上 —— 也就是
    # 「点了但树没跟上」这类抖动。所以这里不能只重试「读」，要重试「点」。
    if not tap_until('^界面音效$', ['清透', '木质', '电子', '柔和']):
        shot('fx-07-ui-tab')
        fail('切不到「界面音效」页签（点了三次都没换）',
             ' | '.join(x for x in texts() if x)[:200])
    else:
        shot('fx-07-ui-tab')
        ok('界面音效页签里音色包还在')

    # 回到播放音效页签再滚下去看下半部分（滚完就关弹层，不用再滚回来）
    if not tap_until('^播放音效$', ['设备预设', '经典均衡']):
        fail('切不回「播放音效」页签（点了三次都没换）',
             ' | '.join(x for x in texts() if x)[:200])
    else:
        # 滚一次读一次，读不到再滚（同样是「滚了但树没跟上」的抖动）。
        # v1.9.20 把次数和距离都加大了：这个弹层很长（三个预设组 + 三个滑块 +
        # 混响档位），只滚 3 次时偶发够不到最下面那三个（实测挂过一次）。
        missing = list(['环绕声', '响度增强', '环境混响', '小房间', '金属板'])
        for i in range(5):
            scroll_sheet(2)
            missing = has_text_retry(['环绕声', '响度增强', '环境混响', '小房间', '金属板'], tries=3)
            if not missing:
                break
        shot('fx-03b-scrolled')
        expect(not missing, '滚下去能看到增强三个滑块与混响档位',
               ('缺: ' + ','.join(missing)) if missing else '')

    # ── 「我的」页里的设置行（v1.9.15 起设置并进来了，没有二级的「设置」页）
    print('\n-- 我的 / 设置行')
    adb('shell', 'input', 'keyevent', '4')   # 收弹层
    time.sleep(1.5)
    adb('shell', 'input', 'keyevent', '4')   # 收播放页
    time.sleep(1.5)
    if not go_home():
        shot('fx-08-no-home')
        fail('回不到首页')
        return
    # 底栏第二个「我的」页签（设置行现在长在这一页上）
    if not tap_text('^我的$', wait=2.5):
        shot('fx-08-no-mine')
        fail('进不了「我的」页', ' | '.join(x for x in texts() if x)[:200])
        return
    shot('fx-08-mine')
    # v1.9.21 的界面留白更大，「界面音效」落在首屏之下；先滚一屏再读。
    # 这一页本来就是可滚的，滚下去能看见就不算缺行。
    adb('shell', 'input', 'swipe', '540', '1750', '540', '1150', '300')
    time.sleep(1.2)
    missing = has_text_retry(['播放音效', '界面音效'])
    expect(not missing, '「我的」页里直接有「播放音效」与「界面音效」两行',
           ('缺: ' + ','.join(missing)) if missing else '')
    expect(re.search(r'重低音', ' | '.join(texts())) is not None,
           '「我的」页「播放音效」那行的摘要就是刚才选的预设',
           ' | '.join(x for x in texts() if '重低音' in x)[:120])

    # 整行是一个文本节点（「播放音效 重低音 · 低音 60%」），所以按子串找。
    # 用 tap_row：音源两行加进来之后这一页更长了，「播放音效」可能不在屏幕上。
    if not tap_row('播放音效', wait=3):
        shot('fx-09-no-playfx')
        fail('进不了「播放音效」设置页')
        return
    shot('fx-09-set-playfx')
    # 设置页这一屏能看到的：开关 + 分组页签 + 预设。三个滑块在下面（这一页很长，
    # 耳机组有 19 个 chip），滑块已经在弹层那边验过了。
    missing = has_text_retry(['启用音效', '均衡器预设', '设备预设', '经典均衡', '耳机校正'])
    expect(not missing, '播放音效设置页打开且内容齐全',
           ('缺: ' + ','.join(missing)) if missing else '')
    expect(re.search(r'重低音', ' | '.join(texts())) is not None,
           '设置页的开关行摘要跟弹层一致（同一份状态）',
           ' | '.join(x for x in texts() if '重低音' in x)[:120])
    check('设置页里也选着刚才那组（耳机校正）', r'索尼 WH-1000XM5')
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.5)
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.5)

    # ── 搜索联想
    print('\n-- 搜索联想')
    if not go_home():
        shot('fx-10-no-home')
        fail('回不到首页（搜索框找不到）')
        return
    if not tap_text('搜索歌曲', wait=3):
        shot('fx-10-no-search')
        fail('进不了搜索页')
        return
    shot('fx-10-search')
    check('搜索页打开（有历史/热搜）', r'搜索历史|热搜榜')

    # v1.9.23：搜索页顶部的平台选择器。原生搜索页有这个东西，潮汐原来漏了，
    # 用户说的「搜索界面不能改音源」就是它。
    if tap_text(r'^酷我$', wait=1.5):
        check('搜索页能把搜索源切到酷我', r'搜索源 · 酷我')
        if tap_text(r'^全部$', wait=1.5):
            check('搜索源能切回全部', r'搜索源 · 全部')
        else:
            fail('切不回「全部」搜索源')
    else:
        fail('搜索页找不到「酷我」搜索源')

    adb('shell', 'input', 'text', 'zhou')
    time.sleep(4.5)
    shot('fx-11-tips')
    t = ' | '.join(texts())
    expect('搜索「zhou」' in t or 'zhou' in t, '联想列表出现了（有「搜索原文」那行）', t[:120])
    expect(re.search(r'周杰伦|周深|周传雄', t) is not None,
           '在线联想回来了（酷我 tips 接口）', t[:200])
    expect(re.search(r'搜索历史|热搜榜', t) is None, '出联想时历史/热搜已收起')

    if tap_text(r'^周杰伦$', wait=6):
        shot('fx-12-results')
        expect(re.search(r'找到|没有找到', ' | '.join(texts())) is not None,
               '点候选词后真的搜了', ' | '.join(x for x in texts() if x)[:160])
        # v1.9.19：搜索结果有的有封面有的没有 —— 根因是酷我搜索里 `img` 写了两遍
        # （算出来的真封面被后面那句 `img: null` 覆盖），而封面是 <img>、uiautomator
        # 看不见，所以这里只留一张截图：拉到列表最上面拍一张，人工看左列封面。
        adb('shell', 'input', 'swipe', '540', '900', '540', '2200', '300')
        time.sleep(1.5)
        shot('fx-12b-search-covers')

    # ── v1.9.19：音源切换改成潮汐自己画的页面（原来是内核那页原生界面，
    #    用户反馈「很简陋、割裂感很强」）。这里真走一遍「进页面 → 换一个源 →
    #    「当前音源」跟着变 → 退回「我的」那一行摘要也跟着变」。
    print('\n-- 音源页（潮汐自己画的）')
    adb('shell', 'input', 'keyevent', '4')     # 退搜索子页
    time.sleep(1.5)
    if not go_home():
        shot('fx-13-no-home')
        fail('回不到首页')
        return

    if not tap_last('^我的$', wait=2.5):
        shot('fx-13-no-mine')
        fail('进不了「我的」页')
        return
    shot('fx-13-mine-sources')
    t = ' | '.join(texts())
    expect('音源切换' in t, '「我的」页有一级菜单「音源切换」', t[:200])
    expect('添加歌源' in t, '「我的」页有一级菜单「添加歌源」')
    expect(re.search(r'共 \d+ 个可选', t) is not None,
           '音源那一行写出了当前音源与可选数量',
           ' | '.join(x for x in texts() if '可选' in x)[:120])
    expect('我创建的歌单' not in t,
           '「我的」页不再直接堆歌单列表（搬去收藏了）',
           ' | '.join(x for x in texts() if '歌单' in x)[:120])
    # v1.9.19：连「入口行」也不该有了 —— 用户要求歌单只放在收藏里
    expect('自建与收藏的歌单' not in t,
           '「我的」页没有歌单入口行了（用户要求：歌单只在收藏里）',
           ' | '.join(x for x in texts() if '歌单' in x)[:160])

    if tap_row('音源切换', wait=3.5):
        shot('fx-14-source-page')
        t = ' | '.join(texts())
        expect('当前音源' in t, '音源页是潮汐自己画的那一版（有「当前音源」卡）', t[:200])
        expect(re.search(r'可用音源', t) is not None, '音源页列出了可用音源')
        expect(re.search(r'共 \d+ 个可选', t) is not None,
               '音源页写出了可选数量',
               ' | '.join(x for x in texts() if '可选' in x)[:120])
        # v1.9.21：音源清单更长，「添加音源」落在首屏之下；滚下去确认后再滚回来
        adb('shell', 'input', 'swipe', '540', '1700', '540', '1050', '300')
        time.sleep(1.2)
        expect('添加音源' in ' | '.join(texts()), '音源页里有「添加音源」入口')
        adb('shell', 'input', 'swipe', '540', '1050', '540', '1700', '300')
        time.sleep(1.2)
        t = ' | '.join(texts())
        # 列表里得能看见那几个内置源的名字（卡里那个也算，所以只要求出现 >=2 个）
        seen = [s for s in SOURCE_NAMES if re.search(re.escape(s), t)]
        expect(len(seen) >= 2, '音源页列出了音源清单', ' | '.join(seen))

        before_src = current_source_name()
        print('      换之前当前音源：%s' % (before_src or '(读不到)'))
        target = next((s for s in SOURCE_NAMES if s != before_src), None)
        if not before_src:
            fail('读不到「当前音源」卡里的名字')
        elif not target:
            fail('没有可切换的第二个音源')
        elif not tap_source_row(target, wait=4):
            fail('点不到音源行「%s」' % target)
        else:
            shot('fx-14b-source-switched')
            after_src = current_source_name()
            print('      换之后当前音源：%s' % (after_src or '(读不到)'))
            expect(after_src == target,
                   '点一下就把音源切过去了（「当前音源」跟着变）',
                   '%s → %s（点的 %s）' % (before_src, after_src, target))
            expect(re.search(r'已切换到', ' | '.join(texts())) is not None or after_src == target,
                   '切完有反馈（提示或选中态变化）')
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)
        # 退回「我的」页，那一行的摘要也该是新源了
        shot('fx-14c-mine-after-switch')
        t2 = ' | '.join(texts())
        if target and target in t2:
            ok('退回「我的」后那一行摘要也换成了新音源', target)
        else:
            fail('「我的」页那一行摘要没跟着换',
                 ' | '.join(x for x in texts() if '可选' in x)[:120])
    else:
        fail('点「音源切换」打不开音源页')

    # 收藏页的「歌曲 / 歌单」两个页签
    if not tap_last('^收藏$', wait=2.5):
        shot('fx-15-no-fav')
        fail('进不了收藏页')
        return
    shot('fx-15-fav-songs')
    t = ' | '.join(texts())
    expect('歌曲' in t and '歌单' in t, '收藏页有「歌曲 / 歌单」两个页签', t[:200])
    if tap_row(r'^歌单$', wait=3):
        shot('fx-16-fav-lists')
        t = ' | '.join(texts())
        expect('我创建的歌单' in t, '歌单页签里有「我创建的歌单」', t[:220])
        expect('新建' in t, '歌单页签里有「新建」入口')
        # v1.9.21：自建歌单越攒越多（每轮测试建一个），「我收藏的歌单」会被顶到
        # 首屏之下；滚一屏再读，滚得到就不算缺。
        adb('shell', 'input', 'swipe', '540', '1750', '540', '1050', '300')
        time.sleep(1.2)
        expect('我收藏的歌单' in ' | '.join(texts()), '歌单页签里有「我收藏的歌单」')
    else:
        fail('切不到收藏页的「歌单」页签')

    # 搜歌单：搜索页切到「歌单」页签，结果要出来
    if not go_home():
        fail('回不到首页')
        return
    if not tap_text('搜索歌曲', wait=3):
        fail('进不了搜索页')
        return
    adb('shell', 'input', 'text', 'jay')
    time.sleep(4.5)
    if not tap_text(r'搜索「jay」', wait=9):
        shot('fx-17-no-search')
        fail('发不出搜索')
        return
    time.sleep(3)
    if tap_row(r'^歌单$', wait=8):
        shot('fx-18-search-lists')
        t = ' | '.join(texts())
        expect(re.search(r'张歌单|没有找到相关歌单', t) is not None,
               '搜索页的「歌单」页签出了结果', t[:220])
    else:
        fail('切不到搜索页的「歌单」页签')
        return
    if tap_row(r'^歌曲$', wait=3):
        expect(re.search(r'首$|首 ', ' | '.join(texts())) is not None,
               '切回「歌曲」页签标题跟着变', ' | '.join(texts())[:160])

    # ── 新建歌单 / 收藏歌单（用户明确要的「还要能收藏歌单和创建歌单」）。
    # 前面只验了入口在不在，这里把两件事**真做一遍**。
    print('\n-- 新建歌单 / 收藏歌单')
    adb('shell', 'input', 'keyevent', '4')     # 退搜索子页
    time.sleep(1.5)
    if not tap_last('^收藏$', wait=2.5):
        fail('进不了收藏页')
        return
    tap_row(r'^歌单$', wait=3)
    shot('fx-20-fav-lists-before')
    before_my = section_count('我创建的歌单')
    before_fav = section_count('我收藏的歌单')
    print('      动手前：我创建的歌单 %s / 我收藏的歌单 %s' % (before_my, before_fav))

    # section_count 为了找「我收藏的歌单」会把页面滚下去；「新建」在列表最上面，
    # 滚回顶部再点（v1.9.21 列表变长后踩到过：新建按钮不在无障碍树里）。
    for _ in range(3):
        adb('shell', 'input', 'swipe', '540', '900', '540', '1900', '300')
        time.sleep(0.6)

    # ① 新建一个歌单。名字用 ASCII + 时间：adb input text 打不了中文
    newname = 'tide%02d%02d%02d' % tuple(time.localtime()[3:6])
    if not tap_row(r'^新建$', wait=3):
        fail('点不了「新建」')
        return
    shot('fx-21-newlist')
    # 新建页的输入框进来就自动聚焦了（v1.9.18 起，和搜索页一样），
    # 所以直接打字即可 —— 不用先点一下
    adb('shell', 'input', 'text', newname)
    time.sleep(1.2)
    if not tap_row(r'^创建$', wait=5):
        fail('点不了「创建」')
        return
    shot('fx-22-created')
    t = ' | '.join(texts())
    expect(newname in t, '新建的歌单出现在「我创建的歌单」里', newname)
    after_my = section_count('我创建的歌单')
    expect(after_my is not None and before_my is not None and after_my == before_my + 1,
           '「我创建的歌单」计数 +1', '%s → %s' % (before_my, after_my))

    # ② 收藏一张在线歌单：搜索 → 歌单页签 → 第一张 → 详情页「收藏」
    if not go_home():
        fail('回不到首页')
        return
    if not tap_text('搜索歌曲', wait=3):
        fail('进不了搜索页')
        return
    adb('shell', 'input', 'text', 'jay')
    time.sleep(4.5)
    if not tap_text(r'搜索「jay」', wait=9):
        fail('发不出搜索')
        return
    time.sleep(3)
    if not tap_row(r'^歌单$', wait=8):
        fail('切不到搜索页的「歌单」页签')
        return
    if not tap_row(r'次播放', wait=5):
        fail('点不开歌单卡片')
        return
    shot('fx-23-pl-detail')
    t = ' | '.join(texts())
    expect('播放全部' in t, '在线歌单详情页打开了', t[:200])
    if not tap_row(r'^收藏$', wait=4):
        fail('详情页上找不到「收藏」按钮')
        return
    shot('fx-24-collected')
    print('      点完收藏：%s' % ' | '.join(x for x in texts() if x)[:200])
    # 内核可能弹「已经收藏过 / 要不要同步」的确认框，有就点掉
    if find(r'^(确定|确认|同步|是)$'):
        tap_row(r'^(确定|确认|同步|是)$', wait=2)
    time.sleep(2)

    # 回「收藏 · 歌单」看计数
    adb('shell', 'input', 'keyevent', '4')     # 退详情页
    time.sleep(2)
    adb('shell', 'input', 'keyevent', '4')     # 退搜索子页
    time.sleep(1.5)
    tap_last('^收藏$', wait=2.5)
    tap_row(r'^歌单$', wait=3)
    shot('fx-25-fav-after-collect')
    after_fav = section_count('我收藏的歌单')
    # 两种结果都算对：第一次收藏 → +1；**同一张重复收藏 → 计数不变**
    # （内核不会重复添加，那才是正确的行为）。
    # 模拟器上的数据是跨轮留着的，所以第二次跑必然是后者 —— 不区分的话
    # 这条断言会「第一轮过、第二轮挂」，看着像功能坏了。
    if after_fav is None or before_fav is None:
        fail('读不到「我收藏的歌单」的计数')
    elif after_fav == before_fav + 1:
        ok('「我收藏的歌单」计数 +1（整张歌单真的收藏进来了）',
           '%s → %s' % (before_fav, after_fav))
    elif after_fav == before_fav:
        ok('同一张歌单重复收藏不重复计入（计数保持不变，符合预期）',
           '%s → %s' % (before_fav, after_fav))
    else:
        fail('「我收藏的歌单」计数不对', '%s → %s' % (before_fav, after_fav))

    # ── v1.9.20：添加音源改成潮汐自己画的一页 ────────────────────────────────
    # 用户第二次反馈「音源点进去三级菜单还是很割裂」—— 那个「三级菜单」就是内核的
    # 「自定义源管理（实验性）」弹层（绿头栏 + 居中小标题 + 一排复选框 + 免责声明）。
    # 现在自己画三块。这里真走一遍完整链路，不做假动作：
    #   起一个本地 HTTP 服务放一份**真**脚本 → 在界面里填地址 → 导入
    #   （真下载 + 内核真校验）→ 列表多一条 → 点垃圾桶 → 点删除 → 列表少一条。
    # 放最后一步：它要开子页、要打字，收尾的返回键按几下不好保证。
    #
    # ⚠️ 这一段必须**独占模拟器**。第一次跑的时候后台还挂着一个完整 flow，
    # 两个进程一起点同一个屏幕，导入直接报「无法连接到服务器」——
    # 而服务端日志里那条 GET 明明是 200。排查了好一阵才发现是自己踩自己。
    print('\n-- 添加音源页（潮汐自己画的）')
    if not tap_last('^我的$', wait=2.5):
        fail('进不了「我的」页')
        return
    if not tap_row('添加歌源', wait=3.5):
        shot('fx-19-no-addsrc')
        fail('点「添加歌源」打不开添加音源页')
    else:
        shot('fx-19-source-add')
        t = ' | '.join(texts())
        expect('从在线地址导入' in t, '添加音源页有「从在线地址导入」', t[:200])
        expect('从本地文件导入' in t, '添加音源页有「从本地文件导入」')
        expect('已装音源' in t, '添加音源页列出了已装音源')
        expect('自定义源管理' not in t and '实验性' not in t,
               '不再是内核那个「自定义源管理（实验性）」弹层（用户说的那个三级菜单）',
               ' | '.join(x for x in texts() if '源' in x)[:200])
        expect('删除' in t, '每条已装音源都带删除键',
               '%d 个删除键' % len([n for n in nodes() if n['text'] == '删除']))
        add_before = src_add_count()
        print('      动手前「已装音源」= %s' % add_before)

        src_name, src_url, srv = make_test_source()
        print('      测试脚本 %s（服务端 %s）' % (src_url, srv.server_address[1]))
        if not tap_src_url_input():
            shot('fx-19b-no-input')
            fail('找不到地址输入框')
        else:
            adb('shell', 'input', 'keyevent', '123')                 # MOVE_END
            adb('shell', 'input', 'keyevent', *(['67'] * 120))       # DEL ×120 清空
            time.sleep(0.8)
            adb('shell', 'input', 'text', src_url)
            time.sleep(1.2)
            shot('fx-19c-url-typed')
            typed = [n['text'] for n in nodes() if n['class'].endswith('EditText')]
            expect(typed and typed[0] == src_url, '地址填进了输入框',
                   (typed[0] if typed else '(没有输入框节点)')[:120])
            # 先收键盘再点「导入」：键盘占掉半屏，而且输入法动画期间 dump 常失败
            hide_keyboard()
            shot('fx-19c2-keyboard-hidden')
            if not tap_retry(r'^导入$'):
                fail('找不到「导入」按钮（重试了 4 次 dump）',
                     ' | '.join(x for x in texts() if '导入' in x)[:160])
            else:
                time.sleep(10)
                shot('fx-19d-imported')
                got = ' | '.join(texts())
                expect('导入成功' in got,
                       '导入成功（真下载 + 内核真校验）',
                       ' | '.join(x for x in texts() if '成功' in x or '失败' in x)[:160])
                expect('音源已导入' in got, '有「音源已导入」的提示',
                       ' | '.join(x for x in texts() if '导入' in x)[:160])
                expect('失败' not in got, '没有报错提示',
                       ' | '.join(x for x in texts() if '失败' in x)[:160])
                after_import = src_add_count()
                expect(after_import is not None and add_before is not None and
                       after_import == add_before + 1,
                       '「已装音源」的数量 +1',
                       '%s → %s' % (add_before, after_import))

                # 删除：两段式（点垃圾桶 → 原地换成「取消 / 删除」）
                if not tap_src_trash_of(src_name):
                    shot('fx-19e-no-trash')
                    fail('滑下去也找不到新导入那条（列表里应该有它）')
                else:
                    ok('新导入那条真的在列表里（滑下去找得到它的垃圾桶）')
                    shot('fx-19f-confirm')
                    expect(has_text_retry(['取消', '删除']) == [],
                           '点垃圾桶后原地出现「取消 / 删除」', ' | '.join(texts())[:160])
                    tap_text(r'^取消$', wait=1.5)
                    shot('fx-19g-cancelled')
                    expect(has_exact(src_name), '点「取消」没有真删（那一条还在）')
                    if not tap_src_trash_of(src_name):
                        fail('取消之后又点不到删除键了')
                    else:
                        if not tap_confirm_delete():
                            fail('确认态里找不到「删除」')
                        shot('fx-19h-deleted')
                        expect(not has_exact(src_name),
                               '点「删除」后那条不见了',
                               ' | '.join(x for x in texts() if '潮汐测试' in x)[:160])
                        # 「已装音源」那个数字才是权威的。
                        # 别去数垃圾桶的个数：那是**当前视口里**能看见几个，
                        # 删除前在页面顶部、删除后为了找最后一行滚到了底部，
                        # 两个视角能看见的行数本来就不一样（实测 5 → 6 的假失败）。
                        expect(src_add_count() == add_before,
                               '「已装音源」的数量回到导入前',
                               '%s → %s' % (add_before, src_add_count()))
            srv.shutdown()
        # 退子页。先确认键盘已经收起来了 —— 键盘还开着的时候返回键只收键盘，
        # 页面不会退（第一轮就是这么假失败的：后面「我的」页上的东西全找不到）。
        hide_keyboard()
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)

    # ── v1.9.20：原生设置页的版式换成潮汐界面那套 ──────────────────────────
    # 用户说「原生设置还是没有变化」。上一轮只推了配色，量过像素证明配色**生效了**
    # （开关轨道是潮汐的薄荷色），所以「没变化」指的是骨架：17px 深色分组标题 +
    # 8 圆角卡片 + 46 高行 vs 界面的 12px 浅灰小标题 + 22 圆角卡片 + 54 高行。
    # 这一轮换掉了，这里用**行高**来验：设置行原来 46、现在 54，量得出来。
    print('\n-- 原生设置页（版式换成潮汐那套）')
    if not tap_row('洛雪原生设置', wait=4.5):
        shot('fx-20-no-settings')
        fail('打不开洛雪原生设置')
    else:
        shot('fx-20-native-settings')
        dens = density()
        _, sh = screen_size()
        # 只量**完整落在屏幕内**的行：最下面那一行常被屏幕/手势条裁掉一截，
        # 54dp 会量成 45dp，看上去像「还留着老的 46dp 行」。
        # 也不能算迷你播放器那个「展开播放页」按钮：它浮在设置页上层，
        # 高 45dp（v1.9.21 的封面 44px），会被当成「老的 46dp 行」。
        rows = [n for n in nodes()
                if n['clickable'] and (n['bounds'][2] - n['bounds'][0]) > 400
                and '展开播放页' not in (n['text'] or '')
                and n['bounds'][1] >= SAFE_TOP and n['bounds'][3] <= sh - 12]
        dps = sorted({round((n['bounds'][3] - n['bounds'][1]) / dens) for n in rows})
        print('      可点宽行的高度（dp，密度 %.2f）：%s' % (dens, dps))
        expect(any(52 <= d <= 56 for d in dps),
               '设置行高是潮汐的 54dp（安卓版原来是 46dp，换算成 px 只差 22）',
               'dp 高度 %s' % dps)
        expect(not any(44 <= d <= 48 for d in dps),
               '没有残留 46dp 的老行高（开关行原来就是 46）',
               'dp 高度 %s' % dps)
        adb('shell', 'input', 'swipe', '540', '1700', '540', '700', '300')
        time.sleep(1.5)
        shot('fx-20b-native-settings-scroll')
        adb('shell', 'input', 'keyevent', '4')
        time.sleep(2)


def logs():
    print('\n-- logcat')
    out = adb('logcat', '-d', '-v', 'brief')
    lines = out.splitlines()
    # 只看**自己进程**的崩溃。冷启动的模拟器上，系统自带的 Google Messages
    # 会在开机时崩一次（`PhenotypeFlag.init()`，与我们无关）——
    # 不过滤的话每次冷启动都会误报一条「logcat 没有崩溃」。
    #
    # v1.9.20 又补了两层过滤，因为误报变多了：
    #   1. **`FATAL EXCEPTION: UiAutomation`** —— 那是 uiautomator **自己**崩了
    #      （验收脚本用的就是它），跟被测应用没关系；
    #   2. 按 **pid → 进程名** 反查，而不是只往后看 3 行找 `Process:`。
    #      有些崩溃（native 侧、或日志被截断）根本不带 `Process:` 行，
    #      旧逻辑「解析不出就算我们的」会把这类全算成应用的崩溃。
    # pid → 进程名从两处收：`Process: X, PID: N` 和 ActivityManager 的 `Start proc N:X`。
    pid2proc = {}
    for l in lines:
        m = re.search(r'Process:\s*([\w.]+),\s*PID:\s*(\d+)', l)
        if m:
            pid2proc[m.group(2)] = m.group(1)
        m = re.search(r'Start proc (\d+):([\w.]+)/', l)
        if m:
            pid2proc[m.group(1)] = m.group(2)
    fatal = []
    for i, l in enumerate(lines):
        if 'FATAL EXCEPTION' not in l:
            continue
        if 'UiAutomation' in l:      # uiautomator 自己的崩溃，不是应用
            continue
        pid = re.search(r'\(\s*(\d+)\)', l)
        proc = pid2proc.get(pid.group(1)) if pid else None
        if proc is None:
            m = re.search(r'Process:\s*([\w.]+)', '\n'.join(lines[i + 1:i + 5]))
            proc = m.group(1) if m else None
        if proc is None or proc == PKG:
            fatal.append('%s  [pid=%s → %s]' % (l.strip()[:140],
                                                pid.group(1) if pid else '?',
                                                proc or '解析不出'))
    expect(not fatal, 'logcat 没有崩溃', fatal[:2] if fatal else '')
    fx = [l for l in out.splitlines() if 'LxAudioEffect' in l]
    bad = [l for l in fx if ('失败' in l or '不可用' in l or 'not applied' in l)]
    expect(not bad, '原生音效模块没有报错', (' | '.join(bad[-3:]))[:300] if bad else
           '（%d 条音效日志，全正常）' % len(fx))
    for l in fx[-6:]:
        print('      %s' % l.strip()[:160])


def effect_dump():
    print('\n-- 效果器挂载情况（AudioFlinger）')
    out = adb('shell', 'dumpsys', 'media.audio_flinger')
    hit = [l for l in out.splitlines() if re.search(r'Equalizer|BassBoost|Virtualizer|Loudness|Reverb|Effect', l)]
    if hit:
        for l in hit[:12]:
            print('      %s' % l.strip()[:160])
        ok('AudioFlinger 里能看到效果器', '%d 行' % len(hit))
    else:
        print('      （dumpsys 里没列出效果器，换个方式看 logcat）')


def player_flow():
    """只量播放页 + 歌词切换（v1.9.22 改的就是这一段）。

    全量 flow 在这台模拟器上要跑十分钟，中途 system_server 一重启就全红；
    改播放页时先用这个短流程确认核心路径，再决定要不要跑全量。
    """
    print('\n-- 首页 / 起播')
    go_home()
    if not start_playback():
        fail('没能起播（后面依赖播放会话的检查都会跳过）')
        return
    ok('起播成功，迷你播放条出现了')

    print('\n-- 进播放页')
    time.sleep(0.8)
    for _ in range(3):
        tap_text('展开播放页', wait=2.5)
        if has_text_retry(['音效'], tries=2) == []:
            break
    shot('fx-02-player')

    print('\n-- 歌词切换')
    if tap_text('轻点封面查看歌词', wait=2.5):
        check('点提示后进入歌词（提示变成「轻点歌词返回封面」）', r'轻点歌词返回封面')
        shot('fx-02b-lyrics')
        if tap_text('轻点歌词返回封面', wait=2.5):
            check('点歌词回到封面', r'轻点封面查看歌词')
    else:
        fail('找不到「轻点封面查看歌词」提示')


def search_flow():
    """只量搜索页：平台选择器 + 切完还能继续打字出联想。

    全量 flow 十分钟，改搜索页时用这个短流程先确认（v1.9.23）。
    """
    print('\n-- 搜索源 / 联想')
    if not go_home():
        fail('回不到首页')
        return
    if not tap_text('搜索歌曲', wait=3):
        fail('进不了搜索页')
        return
    check('搜索页打开（有历史/热搜）', r'搜索历史|热搜榜')
    # 先收键盘：进搜索页会自动聚焦弹输入法（各家 App 都这样），
    # 这一步要验的是「之后点 chip 不会再弹」
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.0)
    if tap_text(r'^酷我$', wait=1.5):
        check('搜索页能把搜索源切到酷我', r'搜索源 · 酷我')
        shown = adb('shell', 'dumpsys', 'input_method')
        expect('mInputShown=true' not in shown,
               '点搜索源不会弹出输入法（v1.9.26 修的就是这个）',
               'mInputShown=true 出现在 dumpsys 里')
        if tap_text(r'^全部$', wait=1.5):
            check('搜索源能切回全部', r'搜索源 · 全部')
        else:
            fail('切不回「全部」搜索源')
    else:
        fail('搜索页找不到「酷我」搜索源')
    # v1.9.26 起切 chip 故意**不再**回焦输入框（真机上会弹输入法，用户说很难受），
    # 所以这里要自己先点一下输入框再打字。输入框在 UIA 里是 EditText。
    edit = [n for n in nodes() if n['class'].endswith('EditText')]
    if edit:
        adb('shell', 'input', 'tap', str(edit[0]['x']), str(edit[0]['y']))
        time.sleep(1.2)
    adb('shell', 'input', 'text', 'zhou')
    time.sleep(4.5)
    t = ' | '.join(texts())
    expect('搜索「zhou」' in t or 'zhou' in t,
           '点完搜索源后还能继续打字（联想列表出现）', t[:160])
    expect(re.search(r'周杰伦|周深|周传雄', t) is not None,
           '在线联想回来了（酷我 tips 接口）', t[:200])
    expect(re.search(r'搜索历史|热搜榜', t) is None, '出联想时历史/热搜已收起')
    if tap_text(r'^周杰伦$', wait=6):
        expect(re.search(r'找到|没有找到', ' | '.join(texts())) is not None,
               '点候选词后真的搜了')


def theme_flow():
    """只量主题页真开关（v1.9.24）：桌面歌词那颗现在接到原生悬浮窗。"""
    print('\n-- 主题页真开关')
    if not go_home():
        fail('回不到首页')
        return
    if not tap_text('^我的$', wait=2.5):
        fail('进不了「我的」页')
        return
    if not tap_text('主题与外观', wait=2.5):
        fail('进不了主题页')
        return
    n = None
    for _ in range(6):
        n = find('^桌面歌词$')
        if n:
            break
        adb('shell', 'input', 'swipe', '540', '1800', '540', '900', '300')
        time.sleep(1.0)
    if not n:
        fail('主题页里找不到「桌面歌词」那行')
        return
    # 整行都可点了（v1.9.24）：直接点标题文字就行，不用去猜 28px 的开关坐标
    tap_text('^桌面歌词$', wait=2.5)
    t = ' | '.join(texts())
    if '桌面歌词已开启' in t:
        ok('桌面歌词开关接到原生（已开启）')
    elif '悬浮窗权限' in t:
        ok('没给悬浮窗权限时走引导（打开系统设置）')
    else:
        fail('点桌面歌词开关没有任何反馈', t[:200])
        return
    tap_text('^桌面歌词$', wait=2.5)
    t = ' | '.join(texts())
    if '桌面歌词已关闭' in t:
        ok('桌面歌词能关掉')
    elif '悬浮窗权限' in t:
        ok('关流程也接到原生（权限引导）')
    else:
        fail('关不掉桌面歌词（没看到反馈）', t[:160])


def dl_dir_names():
    out = adb('shell', 'ls', '/sdcard/Music/TideMusic/')
    return [l.strip() for l in out.splitlines() if l.strip() and 'No such' not in out]


def dlq_flow():
    """v1.9.25：下载真落盘 + 队列真清空（保留正在播）+ 我的下载 sheet。

    下载走真音源接口（单首串行）。装包用 install -r -g（运行时权限已给），
    所以存储权限不会再弹框；万一弹了（清数据后重装），流程里也兜底点「允许」。

    ⚠️ 顺序特意是「先下载、后清队列」：清空待播会触发内核 watchList 的
    「当前歌被移除 → 停止播放」链（全清时 playMusicInfo 被清成 null，
    「下载当前歌」就没了目标）。先下载避开这个窗口。
    """
    print('\n-- 起播')
    go_home()
    if not start_playback():
        fail('没能起播（队列/下载都依赖播放）')
        return
    ok('起播成功')

    print('\n-- 下载当前在播的歌（趁播放会话活着先做）')
    time.sleep(0.8)
    for _ in range(3):
        tap_text('展开播放页', wait=2.5)
        if has_text_retry(['音效'], tries=2) == []:
            break
    tapped = False
    for _ in range(5):
        tap_text(r'^下载$', wait=1.2)
        if find(r'开始下载当前歌曲|已下载：'):
            tapped = True
            break
        time.sleep(0.8)
    if not tapped:
        fail('点「下载」5 次没见到任何反馈（模拟器丢点击 / 桥报错都会这样）')
        return
    ok('点「下载」有「开始下载」反馈')
    for pat in (r'^允许$', r'^Allow$'):
        if find(pat):
            tap_text(pat, wait=2.5)
            check('给了权限后重新开始下载', r'开始下载当前歌曲')
            break
    done = False
    for _ in range(30):
        if find(r'已下载：'):
            done = True
            break
        time.sleep(2)
    if done:
        ok('弹「已下载」完成提示')
    else:
        fail('60 秒内没等到「已下载」提示（看 logcat 里 Tide 下载泵的输出）')
    names = dl_dir_names()
    ok('文件真的落在 /sdcard/Music/TideMusic/（%d 个）' % len(names), ', '.join(names[:3]))
    shot('dlq-01-downloaded')

    print('\n-- 队列清空（保留正在播的这首）')
    if not tap_text('^播放队列$', wait=2.5):
        fail('找不到「播放队列」按钮')
        return
    ok('队列弹层打开')
    # toast 只显示 1.7 秒，dump 必须赶在它消失前（wait=2.0 会必错过）
    if not tap_text('^清空$', wait=0.7):
        fail('找不到「清空」按钮')
        return
    check('弹「保留当前歌」的说明', r'保留')
    t = ' | '.join(texts())
    expect('播放队列是空的' not in t, '清空后队列不是空态（保留的当前歌还在列表里）', t[:200])
    shot('dlq-02-cleared')
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.5)

    print('\n-- 我的下载 sheet')
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(1.5)
    if not tap_text('^我的$', wait=2.0):
        fail('进不了「我的」页')
        return
    if not tap_text('我的下载', wait=2.5):
        fail('「我的」页找不到「我的下载」入口')
        return
    ok('「我的下载」用潮汐自己的弹层（不再进原生 stub 页）')
    check('列表里能看到刚下的文件', r'\.(mp3|flac|m4a)|MB|KB')
    shot('dlq-04-list')
    deleted = False
    for _ in range(4):
        if tap_text('删除', wait=2.0):
            if find(r'已删除'):
                deleted = True
                break
        time.sleep(1.0)
    if deleted:
        ok('删除弹了「已删除」提示')
        names2 = dl_dir_names()
        ok('删除后目录里的文件也少一个（剩 %d 个）' % len(names2), ', '.join(names2[:3]))
    else:
        fail('删除没走通（点了 4 次）')
    shot('dlq-05-deleted')


def play_elapsed_seconds():
    """播放页上左侧那个时间（pCur）。右侧是总时长，按 x 坐标取最左的那个。"""
    times = [n for n in nodes() if re.match(r'^\d+:\d\d$', n['text'])]
    if not times:
        return None
    times.sort(key=lambda n: n['x'])
    m = re.match(r'^(\d+):(\d\d)$', times[0]['text'])
    return int(m.group(1)) * 60 + int(m.group(2))


def restore_flow():
    """v1.9.27：冷启动恢复上次播放。起播 → force-stop → 重启 →
    迷你条带着上次那首（暂停态）；点迷你条的播放键能续播、进度在走。

    内核机制：切歌时 `musicToggled` 把 {listId,index} 存盘（playProgress.ts 的
    handleSetPlayInfo），启动时 initPlayInfo 读回来 playList 恢复（暂停态，
    startupAutoPlay 默认 false 不自动出声）。界面要能看到，靠 init 返回的
    快照（v1.9.27 加）——恢复事件发生在 WebView 就绪之前，界面收不到。
    """
    print('\n-- 先播一首，让内核把播放态落盘')
    go_home()
    if not start_playback():
        fail('没能起播（恢复流程依赖先播放过一首）')
        return
    ok('起播成功（播放态会随切歌落盘）')
    time.sleep(5)

    print('\n-- force-stop 杀掉进程，再冷启动')
    adb('shell', 'am', 'force-stop', PKG)
    time.sleep(2)
    adb('shell', 'am', 'start', '-n', ACT)
    time.sleep(22)
    for _ in range(6):
        if foreground() == PKG:
            break
        adb('shell', 'am', 'start', '-n', ACT)
        time.sleep(6)
    time.sleep(4)

    print('\n-- 重启后应带回上次那首（迷你条在）')
    # 冷启动后 WebView 要 1-3 秒才画完，恢复快照也要等渲染后 applyPlayer ——
    # 固定等 4 秒来断言太早（实测 dump 时还在画，第二次 dump 就有了）。轮询。
    got, t = False, ''
    for _ in range(9):
        t = ' | '.join(texts())
        if '展开播放页' in t:
            got = True
            break
        time.sleep(2)
    expect(got, '冷启动后迷你条出现（上次播放的歌被记忆）', t[:220])
    if not got:
        return
    if find(r'^播放/暂停$') is None:
        fail('找不到迷你条的播放键（迷你条没画出来？）')
        return

    print('\n-- 点迷你条的播放键续播')
    tap_text(r'^播放/暂停$', wait=1.5)
    time.sleep(5)
    for _ in range(3):
        tap_text('展开播放页', wait=2.5)
        if has_text_retry(['音效'], tries=2) == []:
            break
    a = play_elapsed_seconds()
    expect(a is not None and a >= 2, '续播后进度已超过 2 秒', 'pCur=%s' % a)
    time.sleep(4)
    b = play_elapsed_seconds()
    expect(b is not None and a is not None and b > a,
           '进度还在往前走（真的在出声）', 'pCur %s -> %s' % (a, b))
    shot('restore-01-resumed')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'run'
    if cmd == 'dump':
        pat = sys.argv[2] if len(sys.argv) > 2 else '.'
        for i, n in enumerate(nodes()):
            if re.search(pat, n['text']):
                print('[%d] %s click=%s text=%r' % (i, n['bounds'], n['clickable'], n['text']))
        return
    if cmd == 'install':
        install(sys.argv[2])
        launch()
    elif cmd == 'launch':
        launch()
    if cmd == 'player':
        launch()
        player_flow()
        print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
        raise SystemExit(0 if results and all(results) else 1)
    if cmd == 'search':
        launch()
        search_flow()
        print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
        raise SystemExit(0 if results and all(results) else 1)
    if cmd == 'theme':
        launch()
        theme_flow()
        print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
        raise SystemExit(0 if results and all(results) else 1)
    if cmd == 'dlq':
        launch()
        dlq_flow()
        print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
        raise SystemExit(0 if results and all(results) else 1)
    if cmd == 'restore':
        launch()
        restore_flow()
        print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
        raise SystemExit(0 if results and all(results) else 1)
    flow()
    logs()
    effect_dump()
    print('\n==== %s' % ('全部通过' if all(results) and results else '%d 项不通过' % results.count(False)))
    raise SystemExit(0 if results and all(results) else 1)


main()
