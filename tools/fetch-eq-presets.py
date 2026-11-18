"""重新抓一遍开源均衡器预设，核对 src/utils/soundEffectPresets.ts 里的数字。

为什么要留这个脚本：那张表里的 37 条曲线是**从上游仓库抓下来的原值**，不是编的。
上游会更新（VLC 加预设、AutoEq 重算曲线），要核对/更新时得能重跑一次，
而不是靠记忆或者重新去翻网页。

用法:
  python tools/fetch-eq-presets.py            # 抓下来跟本地表对比
  python tools/fetch-eq-presets.py --dump     # 顺便把 TS 代码块打出来

数据来源（两者都是可追溯的开源项目，脚本里会再确认一次许可头）：
  · VLC   modules/audio_filter/equalizer_presets.h    LGPL-2.1-or-later
  · AutoEq results/<来源>/<类型>/<型号>/<型号> FixedBandEQ.txt   MIT
"""
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

UA = {'User-Agent': 'Mozilla/5.0 (tide-music preset check)'}
TS = Path(__file__).resolve().parent.parent / 'src' / 'utils' / 'soundEffectPresets.ts'

VLC_URL = ('https://raw.githubusercontent.com/videolan/vlc/master/'
           'modules/audio_filter/equalizer_presets.h')
AUTOEQ_BASE = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/'

# 与 TS 里那 19 条一一对应：(来源, 类型, 型号, TS 里的 id)。
# id 要显式写出来：光按型号名去匹配会撞车（「Apple AirPods Pro」「Samsung Galaxy Buds Pro」
# 「Beyerdynamic DT 770 Pro」的末词都是 Pro，「Moondrop Blessing 2」的末词是 2），
# 第一版就是按末词匹配，于是拿 DT 770 Pro 的增益去比 AirPods Pro，报了一串假不一致。
AUTOEQ_MODELS = [
    ('oratory1990', 'over-ear', 'Sony WH-1000XM5', 'ae-sony-wh1000xm5'),
    ('oratory1990', 'over-ear', 'Sony WH-1000XM4', 'ae-sony-wh1000xm4'),
    ('oratory1990', 'over-ear', 'Sony WH-1000XM3', 'ae-sony-wh1000xm3'),
    ('oratory1990', 'in-ear', 'Sony WF-1000XM4', 'ae-sony-wf1000xm4'),
    ('oratory1990', 'over-ear', 'Sennheiser HD 600', 'ae-sennheiser-hd600'),
    ('oratory1990', 'over-ear', 'Sennheiser HD 650', 'ae-sennheiser-hd650'),
    ('oratory1990', 'over-ear', 'AKG K371', 'ae-akg-k371'),
    ('oratory1990', 'over-ear', 'Beyerdynamic DT 770 Pro', 'ae-beyer-dt770pro'),
    ('oratory1990', 'over-ear', 'Philips SHP9500', 'ae-philips-shp9500'),
    ('oratory1990', 'over-ear', 'HIFIMAN HE400se', 'ae-hifiman-he400se'),
    ('oratory1990', 'over-ear', 'Apple AirPods Max', 'ae-apple-airpodsmax'),
    ('crinacle', '711 in-ear', 'Apple AirPods Pro', 'ae-apple-airpodspro'),
    ('oratory1990', 'in-ear', 'Samsung Galaxy Buds Pro', 'ae-samsung-budspro'),
    ('oratory1990', 'in-ear', 'Samsung Galaxy Buds2 Pro', 'ae-samsung-buds2pro'),
    ('oratory1990', 'in-ear', 'Moondrop Aria', 'ae-moondrop-aria'),
    ('oratory1990', 'in-ear', 'Moondrop Chu', 'ae-moondrop-chu'),
    ('oratory1990', 'in-ear', 'Moondrop Blessing 2', 'ae-moondrop-blessing2'),
    ('oratory1990', 'in-ear', '7Hz Salnotes Zero', 'ae-7hz-zero'),
    ('oratory1990', 'in-ear', 'Truthear x Crinacle Zero', 'ae-truthear-zero'),
]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def fetch_vlc():
    """返回 [(id, preamp, [10 段增益])]；顺带确认许可头没变"""
    body = get(VLC_URL)
    if 'GNU Lesser General Public License' not in body:
        print('!! VLC 那边的许可头变了，先看一眼再更新表')
    names = re.search(r'preset_list\[NB_PRESETS\]\s*=\s*\{(.*?)\};', body, re.S).group(1)
    names = re.findall(r'"([^"]+)"', names)
    gains = re.findall(r'"(\w+)",\s*10,\s*([\d.]+)f,\s*\{([^}]*)\}', body)
    out = []
    for (pid, preamp, arr), name in zip(gains, names):
        vals = [float(v.strip().rstrip('f')) for v in arr.split(',') if v.strip()]
        # 原文件里的 -1.11022e-15f 就是 0
        vals = [0.0 if abs(v) < 1e-9 else v for v in vals]
        out.append((pid, float(preamp), vals))
    return out


def fetch_autoeq():
    out = []
    for source, kind, model, pid in AUTOEQ_MODELS:
        path = '%s/%s/%s/%s FixedBandEQ.txt' % (source, kind, model, model)
        try:
            body = get(AUTOEQ_BASE + urllib.parse.quote(path))
        except Exception as e:
            out.append((model, pid, None, None, str(e)))
            continue
        pre = re.search(r'Preamp:\s*(-?[\d.]+)', body)
        gains = [float(g) for g in re.findall(r'Gain\s+(-?[\d.]+)\s+dB', body)]
        freqs = [float(f) for f in re.findall(r'Fc\s+([\d.]+)\s+Hz', body)]
        out.append((model, pid, float(pre.group(1)) if pre else None, gains, freqs))
    return out


def main():
    dump = '--dump' in sys.argv
    local = TS.read_text(encoding='utf-8')

    print('=== VLC 经典预设（%s）' % VLC_URL)
    vlc = fetch_vlc()
    print('  抓到 %d 套' % len(vlc))
    bad = []
    for pid, preamp, vals in vlc:
        # TS 里是 { id: 'xxx', ..., gains: [a, b, ...] }
        m = re.search(r"id: '%s',.*?gains: \[([^\]]*)\]" % re.escape(pid), local, re.S)
        if not m:
            bad.append(pid + '（本地表里没有）')
            continue
        got = [float(x) for x in re.findall(r'-?[\d.]+', m.group(1))]
        if len(got) != len(vals) or any(abs(a - b) > 1e-6 for a, b in zip(got, vals)):
            bad.append('%s 本地 %s / 上游 %s' % (pid, got, vals))
        if dump:
            print("  { id: '%s', name: '', freqs: VLC_FREQS, gains: [%s] },"
                  % (pid, ', '.join(('%g' % v) for v in vals)))
    print('  一致' if not bad else '  不一致：\n    ' + '\n    '.join(bad))

    print('\n=== AutoEq 耳机校正（%s）' % AUTOEQ_BASE)
    ae = fetch_autoeq()
    bad2 = []
    for model, pid, preamp, gains, freqs in ae:
        if preamp is None:
            bad2.append('%s：抓不到（%s）' % (model, gains))
            continue
        if len(gains) != 10:
            bad2.append('%s：段数不是 10（%d）' % (model, len(gains)))
            continue
        m = re.search(r"id: '%s',.*?preamp: (-?[\d.]+), gains: \[([^\]]*)\]" % re.escape(pid),
                      local, re.S)
        if not m:
            bad2.append('%s（本地表里找不到 id=%s）' % (model, pid))
            continue
        if abs(float(m.group(1)) - preamp) > 1e-6:
            bad2.append('%s 的 preamp 本地 %s / 上游 %s' % (model, m.group(1), preamp))
        got = [float(x) for x in re.findall(r'-?[\d.]+', m.group(2))]
        if len(got) != 10 or any(abs(a - b) > 1e-6 for a, b in zip(got, gains)):
            bad2.append('%s 的增益不一致\n      本地 %s\n      上游 %s' % (model, got, gains))
        if dump:
            print("  { id: '%s', name: '', freqs: ISO_FREQS, preamp: %s, gains: [%s] },"
                  % (pid, preamp, ', '.join(('%g' % v) for v in gains)))
    print('  一致（%d 条）' % len(ae) if not bad2 else '  不一致：\n    ' + '\n    '.join(bad2))

    print('\n（表在 %s）' % TS)
    raise SystemExit(1 if (bad or bad2) else 0)


main()
