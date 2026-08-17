#!/usr/bin/env python3
"""CLI backtest replika EfataTech EA.

Contoh:
  python3 run_backtest.py --magic 10110 --lot 0.01 --bars 20000 --set xLot=3
  python3 run_backtest.py --csv data_m1.csv --magic 20110 --set exitPct=1
"""

import argparse

from efata.backtest import Backtester
from efata.broker import SymbolSpec
from efata.data import load_csv, synthetic
from efata.params import Params


def main() -> None:
    ap = argparse.ArgumentParser(description="Backtest replika EfataTech EA")
    ap.add_argument("--csv", help="file CSV M1 (time,open,high,low,close)")
    ap.add_argument("--bars", type=int, default=20000,
                    help="jumlah bar sintetis bila tanpa --csv")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--magic", type=int, action="append", required=True,
                    help="magic imZEX 5 digit, boleh diulang (mis. 10110)")
    ap.add_argument("--lot", type=float, default=0.01, help="lot awal per magic")
    ap.add_argument("--balance", type=float, default=10000.0)
    ap.add_argument("--spread", type=int, default=20, help="spread (points)")
    ap.add_argument("--set", action="append", default=[], metavar="NAMA=NILAI",
                    help="override parameter, mis. --set xLot=3 --set exitPct=1")
    args = ap.parse_args()

    params = Params()
    for kv in args.set:
        name, val = kv.split("=", 1)
        if name not in Params.SLOT_NAMES:
            raise SystemExit(f"parameter tidak dikenal: {name}\n"
                             f"pilihan: {', '.join(Params.SLOT_NAMES)}")
        setattr(params, name, float(val))

    bars = load_csv(args.csv) if args.csv else synthetic(args.bars, args.seed)
    spec = SymbolSpec(spread_points=args.spread)
    bt = Backtester(spec=spec, balance=args.balance, params=params)
    for m in args.magic:
        bt.engine.spawn(m, args.lot)

    stats = bt.run(bars)
    print(stats.report())


if __name__ == "__main__":
    main()
