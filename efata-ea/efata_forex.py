#!/usr/bin/env python3
"""efata_forex — runner backtest EfataTech EA untuk pasangan forex (bukan gold).

Reuse penuh engine efata/ yang sama (strategi netral instrumen); yang beda
cuma SymbolSpec (point, digit, contract, spread) sesuai pair forex.

Contoh:
  python3 efata_forex.py --pair EURUSD --magics 10220 10330 --lot 0.03 \
      --spread 15 --set xLot=3 --set exitPct=2 \
      --data eurusd_2018_m1.csv eurusd_2019_m1.csv
"""
import argparse
import sys

sys.path.insert(0, "/home/user/Sinyal-saham-harian/efata-ea")

from efata.backtest import Backtester
from efata.broker import SymbolSpec
from efata.data import load_csv
from efata.params import Params

# Spesifikasi default per pair forex populer (point 5-digit, kontrak standar
# 100.000 unit). Override manual via --spread bila perlu.
PAIR_SPECS = {
    "EURUSD": dict(point=0.00001, digits=5, contract=100000.0, stops_level_points=10),
    "GBPUSD": dict(point=0.00001, digits=5, contract=100000.0, stops_level_points=10),
    "USDJPY": dict(point=0.001,   digits=3, contract=100000.0, stops_level_points=10),
    "AUDUSD": dict(point=0.00001, digits=5, contract=100000.0, stops_level_points=10),
    # Crypto CFD: 1 lot = 1 coin, point=0.01 (harga 2 desimal)
    "BTCUSD": dict(point=0.01, digits=2, contract=1.0, stops_level_points=100),
    "ETHUSD": dict(point=0.01, digits=2, contract=1.0, stops_level_points=100),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--pair", default="EURUSD")
    ap.add_argument("--magics", type=int, nargs="+", required=True)
    ap.add_argument("--lot", type=float, default=0.03)
    ap.add_argument("--balance", type=float, default=10_000.0)
    ap.add_argument("--spread", type=float, default=15.0, help="spread (points)")
    ap.add_argument("--set", action="append", default=[], metavar="K=V")
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    if args.pair not in PAIR_SPECS:
        raise SystemExit(f"Pair {args.pair} belum ada spec-nya. "
                          f"Tersedia: {list(PAIR_SPECS)}")

    sets = {}
    for kv in args.set:
        k, v = kv.split("=", 1)
        sets[k] = float(v)

    spec_kwargs = dict(PAIR_SPECS[args.pair])
    spec_kwargs["name"] = args.pair
    spec_kwargs["spread_points"] = args.spread

    for path in args.data:
        bars = load_csv(path)
        p = Params()
        for k, v in sets.items():
            setattr(p, k, v)
        spec = SymbolSpec(**spec_kwargs)
        bt = Backtester(spec=spec, balance=args.balance, params=p)
        for m in args.magics:
            bt.engine.spawn(m, args.lot)
        st = bt.run(bars)
        eq = bt.broker.equity
        ret = (eq - args.balance) / args.balance * 100.0
        win = 100.0 * st.wins / st.trades if st.trades else 0.0
        print(f"{args.label or '+'.join(map(str, args.magics))} [{args.pair}] "
              f"lot={args.lot:g} spread={args.spread:g}pt "
              f"{path.split('/')[-1]}: eq={eq:10.2f} ({ret:+6.2f}%)  "
              f"PF={min(st.profit_factor, 99):5.2f}  n={st.trades:5d}  "
              f"win={win:4.1f}%  DD={st.max_drawdown_pct:5.1f}%  "
              f"sisa_posisi={st.open_positions}", flush=True)


if __name__ == "__main__":
    main()
