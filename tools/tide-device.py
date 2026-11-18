"""Drive the Tide app on the emulator with real taps, located by visible text.

Why: the WebView content IS visible to uiautomator (its a11y tree exposes the
web text nodes with exact bounds), so we can tap "the button that says 音效"
instead of guessing pixel coordinates from a screenshot. aria-label on a button
shows up as that node's text, which is why the new controls have labels.

Usage:
  python tools/tide-device.py dump [pattern]      # list nodes (optionally filtered)
  python tools/tide-device.py tap <pattern> [n]   # tap the n-th match (default 0)
  python tools/tide-device.py tapxy <x> <y>       # raw device-pixel tap
  python tools/tide-device.py shot <name>         # screencap to music-ui-mobile/shots/dev-<name>.png
  python tools/tide-device.py swipe <x1> <y1> <x2> <y2>
  python tools/tide-device.py key <code>          # e.g. 4 = back
  python tools/tide-device.py text <ascii>        # type into the focused field
"""
import re
import subprocess
import sys
from pathlib import Path

ADB = r'D:\android-tools\sdk\platform-tools\adb.exe'
SHOTS = Path(r'C:\Users\meiyou\.zcode\workspace\default\music-ui-mobile\shots')
DUMP = Path(r'C:\Users\meiyou\AppData\Local\Temp\tide_ui.xml')


def adb(*args, binary=False):
    r = subprocess.run([ADB, *args], capture_output=True)
    if r.returncode != 0 and not binary:
        sys.stderr.write(r.stderr.decode('utf-8', 'replace'))
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/tide_ui.xml')
    raw = adb('pull', '/sdcard/tide_ui.xml', str(DUMP))
    text = DUMP.read_text(encoding='utf-8', errors='replace')
    out = []
    for m in re.finditer(r'<node[^>]*>', text):
        tag = m.group(0)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        t = re.search(r'text="([^"]*)"', tag)
        d = re.search(r'content-desc="([^"]*)"', tag)
        c = re.search(r'clickable="(\w+)"', tag)
        if not b:
            continue
        x1, y1, x2, y2 = (int(g) for g in b.groups())
        label = (t.group(1) if t else '') or (d.group(1) if d else '')
        out.append({
            'text': label, 'desc': d.group(1) if d else '',
            'clickable': c.group(1) if c else 'false',
            'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2,
            'bounds': (x1, y1, x2, y2),
        })
    return out


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'dump'
    if cmd == 'dump':
        pat = sys.argv[2] if len(sys.argv) > 2 else None
        for i, n in enumerate(nodes()):
            if n['bounds'][2] == 0 and n['bounds'][3] == 0:
                continue
            if pat and not re.search(pat, n['text']):
                continue
            print(f"[{i}] {n['bounds']} click={n['clickable']} text='{n['text']}'")
        return
    if cmd == 'tap':
        pat = sys.argv[2]
        want = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        hits = [n for n in nodes()
                if re.search(pat, n['text']) and n['bounds'][2] > 0]
        if not hits:
            print(f"没有匹配 '{pat}' 的节点")
            raise SystemExit(2)
        n = hits[min(want, len(hits) - 1)]
        print(f"tap '{n['text']}' at {n['x']},{n['y']} {n['bounds']}")
        adb('shell', 'input', 'tap', str(n['x']), str(n['y']))
        return
    if cmd == 'tapxy':
        print(f"tap {sys.argv[2]},{sys.argv[3]}")
        adb('shell', 'input', 'tap', sys.argv[2], sys.argv[3])
        return
    if cmd == 'shot':
        SHOTS.mkdir(exist_ok=True)
        dest = SHOTS / f"dev-{sys.argv[2]}.png"
        data = adb('exec-out', 'screencap', '-p', binary=True)
        dest.write_bytes(data)
        print(f"{dest}  {len(data)} bytes")
        return
    if cmd == 'swipe':
        adb('shell', 'input', 'swipe', *sys.argv[2:6])
        print('swiped')
        return
    if cmd == 'key':
        adb('shell', 'input', 'keyevent', sys.argv[2])
        print('key sent')
        return
    if cmd == 'text':
        adb('shell', 'input', 'text', sys.argv[2])
        print('typed')
        return
    print(__doc__)


main()
