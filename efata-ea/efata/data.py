"""Loader data M1 (CSV), generator data sintetis, dan agregator timeframe."""

import csv
import math
import random
from datetime import datetime, timedelta

from .indicators import Bar
from .magic import TF_MINUTES


def load_csv(path: str):
    """Baca CSV M1 dengan kolom time,open,high,low,close[,volume].

    ``time`` boleh epoch detik atau string ``YYYY-MM-DD HH:MM[:SS]``.
    """
    bars = []
    with open(path, newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or not row[0].strip():
                continue
            t = row[0].strip()
            if t.lower() in ("time", "date", "datetime"):
                continue
            try:
                ts = datetime.fromtimestamp(float(t))
            except ValueError:
                t = t.replace("T", " ").replace(".", "-")
                fmt = "%Y-%m-%d %H:%M:%S" if t.count(":") == 2 else "%Y-%m-%d %H:%M"
                ts = datetime.strptime(t, fmt)
            o, h, l, c = (float(x) for x in row[1:5])
            bars.append(Bar(ts, o, h, l, c))
    return bars


def synthetic(n_bars: int = 5000, seed: int = 1, start_price: float = 2400.0,
              vol: float = 0.8, drift: float = 0.0,
              start_time: datetime = None):
    """Data M1 sintetis: random walk + gelombang, cukup utk uji mesin EA."""
    rng = random.Random(seed)
    t = start_time or datetime(2025, 1, 6, 0, 0)
    price = start_price
    bars = []
    phase = rng.random() * math.tau
    for i in range(n_bars):
        wave = 0.3 * vol * math.sin(i / 37.0 + phase) + \
               0.15 * vol * math.sin(i / 211.0 + phase * 2)
        step = rng.gauss(drift, vol) + wave
        o = price
        c = max(1.0, price + step)
        spread_hl = abs(rng.gauss(0, vol * 0.7)) + 0.05
        h = max(o, c) + spread_hl * 0.5
        l = max(0.5, min(o, c) - spread_hl * 0.5)
        bars.append(Bar(t, round(o, 2), round(h, 2), round(l, 2), round(c, 2)))
        price = c
        t += timedelta(minutes=1)
    return bars


class TFAggregator:
    """Gabungkan bar M1 selesai menjadi bar timeframe lebih besar."""

    def __init__(self, tf: str):
        self.minutes = TF_MINUTES[tf]
        self._cur = None  # bar sedang dibangun

    def _bucket(self, ts: datetime) -> datetime:
        if self.minutes >= 43200:      # MN1
            return ts.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if self.minutes >= 10080:      # W1: mulai Senin
            d = ts - timedelta(days=ts.weekday())
            return d.replace(hour=0, minute=0, second=0, microsecond=0)
        epoch_min = int(ts.timestamp() // 60)
        b = (epoch_min // self.minutes) * self.minutes
        return datetime.fromtimestamp(b * 60)

    def feed(self, bar: Bar):
        """Masukkan bar M1 selesai; return bar TF selesai bila baru menutup."""
        b = self._bucket(bar.time)
        closed = None
        if self._cur is None or self._cur.time != b:
            closed = self._cur
            self._cur = Bar(b, bar.o, bar.h, bar.l, bar.c)
        else:
            cur = self._cur
            cur.h = max(cur.h, bar.h)
            cur.l = min(cur.l, bar.l)
            cur.c = bar.c
        return closed
