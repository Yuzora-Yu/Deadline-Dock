#!/usr/bin/env python3
"""Create a Windows-friendly ZIP with validated UTF-8 filenames.

Python's zipfile sets ZIP general-purpose flag bit 11 for non-ASCII filenames.
This script verifies that behavior and checks that archive names exactly match
source names before a package is considered valid.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import zipfile

SKIP_PARTS = {"node_modules", "target", "dist", ".git", "windows-build", "backups"}


def files_under(source: Path):
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_PARTS for part in path.relative_to(source).parts):
            continue
        if path.name.startswith(("deadline-dock-backup-", "client_secret", "credentials")) or path.suffix in {".db", ".log"} or path.name.startswith(".env"):
            continue
        yield path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--root-name", default=None, help="top-level folder name in ZIP; empty means no added root")
    args = ap.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        raise SystemExit(f"source directory not found: {source}")

    root_name = source.name if args.root_name is None else args.root_name.strip("/\\")
    expected: list[str] = []
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files_under(source):
            rel = path.relative_to(source).as_posix()
            arc = f"{root_name}/{rel}" if root_name else rel
            expected.append(arc)
            zf.write(path, arc)

    with zipfile.ZipFile(output, "r") as zf:
        infos = zf.infolist()
        actual = [info.filename for info in infos]
        if actual != expected:
            missing = sorted(set(expected) - set(actual))
            extra = sorted(set(actual) - set(expected))
            raise SystemExit(f"ZIP filename mismatch. missing={missing[:5]} extra={extra[:5]}")
        for info in infos:
            if any(ord(ch) > 127 for ch in info.filename) and not (info.flag_bits & 0x800):
                raise SystemExit(f"non-ASCII filename lacks UTF-8 ZIP flag: {info.filename!r}")

            # Windows PowerShell 5.1 does not reliably interpret UTF-8 .ps1
            # files that contain non-ASCII text unless a BOM is present.
            # Validate packaged scripts so release/update ZIPs cannot regress.
            if info.filename.lower().endswith(".ps1"):
                data = zf.read(info)
                has_non_ascii = any(byte >= 0x80 for byte in data)
                if has_non_ascii and not data.startswith(b"\xef\xbb\xbf"):
                    raise SystemExit(
                        f"PowerShell script contains non-ASCII text but lacks UTF-8 BOM: {info.filename!r}"
                    )

    print(f"OK: {output}")
    print(f"files: {len(expected)}")
    print("UTF-8 filename verification: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
