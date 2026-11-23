"""Rebuild corpus.zip from a folder of corpus files, byte for byte reproducibly.

Usage: python evaluation/build_corpus.py <folder>   (writes evaluation/corpus.zip)

The corpus is kept zipped so that its deliberately vulnerable files are not scanned as part of
this repository (by GitHub's secret scanning, Dependabot, or the app's own analysis of itself).
"""

import sys
import zipfile
from pathlib import Path

source = Path(sys.argv[1])
target = Path(__file__).resolve().parent / "corpus.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(p for p in source.rglob("*") if p.is_file()):
        info = zipfile.ZipInfo(file.relative_to(source).as_posix(), date_time=(2026, 11, 23, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, file.read_bytes().replace(b"\r\n", b"\n"))
print(f"wrote {target}")
