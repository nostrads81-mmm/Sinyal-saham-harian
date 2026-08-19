#!/usr/bin/env python3
"""Ekspor bar M1 dari terminal MT5 (Windows) ke CSV siap run_backtest.py.

Jalankan di VPS Windows tempat MT5 berjalan:
  pip install MetaTrader5
  python mt5_export.py --symbol XAUUSDc --days 365 --out xauusdc_m1.csv

Lalu backtest dengan data broker sendiri:
  python run_backtest.py --csv xauusdc_m1.csv --magic 10220 --magic 10330 \
      --lot 0.03 --spread 26 --set xLot=3 --set exitPct=2 --set exitRR=0 \
      --set exitUSD=0 --set maxLevCut=2 --set minMarginLev=500 \
      --set lossMaxPersen=15
"""

import argparse
import csv
from datetime import datetime, timedelta

try:
    import MetaTrader5 as mt5
except ImportError:
    raise SystemExit("Modul belum ada. Jalankan:  pip install MetaTrader5")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--symbol", default="XAUUSDc")
    ap.add_argument("--days", type=int, default=365, help="mundur berapa hari")
    ap.add_argument("--out", default="xauusdc_m1.csv")
    args = ap.parse_args()

    if not mt5.initialize():
        raise SystemExit(f"Gagal konek ke terminal MT5: {mt5.last_error()}\n"
                         "Pastikan MT5 sedang berjalan dan login.")
    try:
        if not mt5.symbol_select(args.symbol, True):
            raise SystemExit(f"Simbol {args.symbol} tidak ditemukan. "
                             "Cek nama persisnya di Market Watch.")
        info = mt5.symbol_info(args.symbol)
        print(f"{args.symbol}: point={info.point} contract={info.trade_contract_size} "
              f"spread_sekarang={info.spread} stops_level={info.trade_stops_level}")

        utc_to = datetime.now()
        utc_from = utc_to - timedelta(days=args.days)
        rates = mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M1,
                                     utc_from, utc_to)
        if rates is None or len(rates) == 0:
            raise SystemExit(f"Tidak ada data: {mt5.last_error()}\n"
                             "Broker mungkin membatasi histori; coba --days lebih kecil.")
        with open(args.out, "w", newline="") as f:
            w = csv.writer(f)
            for r in rates:
                t = datetime.fromtimestamp(int(r["time"]))
                w.writerow([t.strftime("%Y-%m-%d %H:%M"),
                            f"{r['open']:.3f}", f"{r['high']:.3f}",
                            f"{r['low']:.3f}", f"{r['close']:.3f}"])
        print(f"{len(rates)} bar M1 -> {args.out} "
              f"({rates[0]['time']} .. {rates[-1]['time']} epoch)")
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
