# -*- coding: utf-8 -*-
"""Prune old TideMusic APKs in the AI-installers folder.

The user's rule (2026-11-18): all AI-made installers live in one folder and
every delivery keeps only the newest build. deliver-arm64.py already prunes on
each delivery; this script is the manual safety net (e.g. after moving files by
hand, or if an older build was copied in from somewhere else).

Families (each keeps its newest only):
  * 潮汐音乐-手机版-*.apk        (new naming)
  * TideMusic-v*-arm64.apk       (legacy naming)
  * 潮汐音乐-平板版-*.apk
  * TideMusic-Pad-v*-arm64.apk

Files from other projects in that folder are never touched.

    python -I tools/prune-delivered-apks.py
    python -I tools/prune-delivered-apks.py --dry
"""
import os
import re
import sys
from pathlib import Path

OUT = Path(r'C:\Users\meiyou\Desktop\ai做的安装包')

FAMILIES = {
    '手机版': ['潮汐音乐-手机版-*.apk', 'TideMusic-v*-arm64.apk'],
    '平板版': ['潮汐音乐-平板版-*.apk', 'TideMusic-Pad-v*-arm64.apk'],
}

VER_RE = re.compile(r'(\d+(?:\.\d+)+)')


def version_key(p: Path):
    m = VER_RE.search(p.name)
    if m:
        return tuple(int(x) for x in m.group(1).split('.'))
    return ()  # no version -> treat as oldest


def main():
    dry = '--dry' in sys.argv
    if not OUT.is_dir():
        raise SystemExit('folder not found: %s' % OUT)
    for label, patterns in FAMILIES.items():
        files = []
        for pat in patterns:
            files.extend(p for p in OUT.glob(pat) if p.is_file())
        # de-dup (a name could match two patterns in theory)
        files = sorted(set(files), key=lambda p: (version_key(p), p.stat().st_mtime))
        if len(files) <= 1:
            print('%s: %d apk(s), nothing to prune' % (label, len(files)))
            continue
        keep = files[-1]
        print('%s: keep %s' % (label, keep.name))
        for old in files[:-1]:
            size = old.stat().st_size / 1048576
            if dry:
                print('  would delete: %s  (%.2f MB)' % (old.name, size))
                continue
            os.remove(old)
            print('  deleted: %s  (%.2f MB)' % (old.name, size))
    print('\nleft in %s:' % OUT)
    for p in sorted(OUT.glob('*.apk')):
        print('  %-40s %.2f MB' % (p.name, p.stat().st_size / 1048576))


main()
