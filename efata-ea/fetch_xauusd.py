#!/usr/bin/env python3
"""Unduh tick XAUUSD riil (repo publik FX-Data, 2007-2018) -> CSV bar M1.

Sumber: github.com/FX-Data/FX-Data-XAUUSD-DS — tick per jam per branch tahun.
Harga di sumber terskala 1/100 (13.12 = $1312); script mengalikannya 100.
Bar M1 dibentuk dari harga bid (konvensi bar MT5).

Contoh:
  python3 fetch_xauusd.py --year 2018 --months 1 2 3 --out xauusd_m1.csv
"""

import argparse
import csv
import glob
import os
import shutil
import subprocess
import tempfile

REPO = "https://github.com/FX-Data/FX-Data-XAUUSD-DS.git"


def aggregate(src_dir: str, out, scale: float = 100.0) -> int:
    bars = {}
    for path in sorted(glob.glob(f"{src_dir}/*_ticks.csv")):
        with open(path, newline="") as f:
            for row in csv.reader(f):
                if len(row) < 2:
                    continue
                try:
                    bid = float(row[1]) * scale
                except ValueError:
                    continue
                key = row[0][:16].replace(".", "-", 2)  # YYYY-MM-DD HH:MM
                b = bars.get(key)
                if b is None:
                    bars[key] = [bid, bid, bid, bid]
                else:
                    if bid > b[1]:
                        b[1] = bid
                    if bid < b[2]:
                        b[2] = bid
                    b[3] = bid
    w = csv.writer(out)
    for key in sorted(bars):
        o, h, l, c = bars[key]
        w.writerow([key, f"{o:.3f}", f"{h:.3f}", f"{l:.3f}", f"{c:.3f}"])
    return len(bars)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, default=2018, help="2007-2018")
    ap.add_argument("--months", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--out", default="xauusd_m1.csv")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="fxdata_")
    clone = os.path.join(tmp, "repo")
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", str(args.year),
             "--filter=blob:none", "--sparse", REPO, clone],
            check=True)
        total = 0
        with open(args.out, "w", newline="") as out:
            for m in args.months:
                sub = f"XAUUSD/{args.year}/{m:02d}"
                subprocess.run(["git", "sparse-checkout", "set", sub],
                               cwd=clone, check=True)
                n = aggregate(os.path.join(clone, sub), out)
                total += n
                print(f"{args.year}-{m:02d}: {n} bar M1")
                shutil.rmtree(os.path.join(clone, "XAUUSD"), ignore_errors=True)
        print(f"total {total} bar -> {args.out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
