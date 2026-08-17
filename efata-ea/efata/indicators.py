"""Indikator yang dipakai EfataTech EA, dihitung inkremental per bar selesai.

Konvensi indeks meniru MQL5: "bar 1" = bar selesai terakhir, "bar 2" =
sebelumnya, dst. Array internal berisi HANYA bar selesai; bar k diakses
lewat indeks ``len - k``. "Bar 0" (bar berjalan) diaproksimasi dengan harga
sekarang bila diperlukan (mis. gate MACD bar 0).

Indikator: MACD(5,13,1) PRICE_WEIGHTED, Fractals Bill Williams, ATR Wilder,
ADX Wilder, RSI Wilder, Ichimoku, Donchian (highest/lowest N bar).
"""

import math
from dataclasses import dataclass


@dataclass
class Bar:
    time: object  # datetime
    o: float
    h: float
    l: float
    c: float


def _ema_next(prev, x, period):
    k = 2.0 / (period + 1.0)
    return x if prev is None else prev + k * (x - prev)


class IndicatorSet:
    """Kumpulan indikator satu timeframe, diupdate tiap bar selesai."""

    def __init__(self, macd_fast=5, macd_slow=13, atr_period=20,
                 adx_period=14, rsi_period=14):
        self.macd_fast = macd_fast
        self.macd_slow = macd_slow
        self.atr_period = atr_period
        self.adx_period = adx_period
        self.rsi_period = rsi_period

        self.time, self.o, self.h, self.l, self.c = [], [], [], [], []
        self.macd = []           # main line EMAfast(wp)-EMAslow(wp), signal=1
        self.atr = []            # Wilder ATR
        self.adx = []            # Wilder ADX
        self.rsi = []            # Wilder RSI (close)
        self.fract_up = []       # bool per bar (dikonfirmasi 2 bar kemudian)
        self.fract_dn = []

        self._ema_f = None
        self._ema_s = None
        self._atr_w = None
        self._tr_w = None
        self._dmp_w = None
        self._dmn_w = None
        self._adx_w = None
        self._rsi_gain = None
        self._rsi_loss = None

    def __len__(self):
        return len(self.c)

    # ------------------------------------------------------------------ core
    def add_bar(self, bar: Bar) -> None:
        i = len(self.c)
        self.time.append(bar.time)
        self.o.append(bar.o)
        self.h.append(bar.h)
        self.l.append(bar.l)
        self.c.append(bar.c)

        # MACD price weighted (H+L+2C)/4
        wp = (bar.h + bar.l + 2 * bar.c) / 4.0
        self._ema_f = _ema_next(self._ema_f, wp, self.macd_fast)
        self._ema_s = _ema_next(self._ema_s, wp, self.macd_slow)
        self.macd.append(self._ema_f - self._ema_s)

        # ATR Wilder
        if i == 0:
            tr = bar.h - bar.l
        else:
            pc = self.c[i - 1]
            tr = max(bar.h - bar.l, abs(bar.h - pc), abs(bar.l - pc))
        self._atr_w = tr if self._atr_w is None else (
            (self._atr_w * (self.atr_period - 1) + tr) / self.atr_period)
        self.atr.append(self._atr_w)

        # ADX Wilder
        if i == 0:
            dmp = dmn = 0.0
        else:
            up = bar.h - self.h[i - 1]
            dn = self.l[i - 1] - bar.l
            dmp = up if (up > dn and up > 0) else 0.0
            dmn = dn if (dn > up and dn > 0) else 0.0
        p = self.adx_period
        self._tr_w = tr if self._tr_w is None else (self._tr_w * (p - 1) + tr) / p
        self._dmp_w = dmp if self._dmp_w is None else (self._dmp_w * (p - 1) + dmp) / p
        self._dmn_w = dmn if self._dmn_w is None else (self._dmn_w * (p - 1) + dmn) / p
        if self._tr_w > 0:
            dip = 100.0 * self._dmp_w / self._tr_w
            din = 100.0 * self._dmn_w / self._tr_w
        else:
            dip = din = 0.0
        dx = 100.0 * abs(dip - din) / (dip + din) if (dip + din) > 0 else 0.0
        self._adx_w = dx if self._adx_w is None else (self._adx_w * (p - 1) + dx) / p
        self.adx.append(self._adx_w)

        # RSI Wilder
        if i == 0:
            gain = loss = 0.0
        else:
            ch = bar.c - self.c[i - 1]
            gain = max(ch, 0.0)
            loss = max(-ch, 0.0)
        rp = self.rsi_period
        self._rsi_gain = gain if self._rsi_gain is None else (
            (self._rsi_gain * (rp - 1) + gain) / rp)
        self._rsi_loss = loss if self._rsi_loss is None else (
            (self._rsi_loss * (rp - 1) + loss) / rp)
        if self._rsi_loss == 0:
            rsi = 100.0 if self._rsi_gain > 0 else 50.0
        else:
            rs = self._rsi_gain / self._rsi_loss
            rsi = 100.0 - 100.0 / (1.0 + rs)
        self.rsi.append(rsi)

        # Fractals: konfirmasi bar i-2 setelah bar i selesai
        self.fract_up.append(False)
        self.fract_dn.append(False)
        j = i - 2
        if j >= 2:
            hj = self.h[j]
            if all(hj > self.h[j + k] for k in (-2, -1, 1, 2)):
                self.fract_up[j] = True
            lj = self.l[j]
            if all(lj < self.l[j + k] for k in (-2, -1, 1, 2)):
                self.fract_dn[j] = True

    # -------------------------------------------------------------- akses bar
    def _idx(self, bars_ago: int) -> int:
        return len(self.c) - bars_ago

    def val(self, arr, bars_ago: int):
        i = self._idx(bars_ago)
        if i < 0 or i >= len(arr):
            return None
        return arr[i]

    def macd_bar0(self, price: float) -> float:
        """Aproksimasi MACD bar berjalan memakai harga sekarang sbg wp."""
        if self._ema_f is None:
            return 0.0
        f = _ema_next(self._ema_f, price, self.macd_fast)
        s = _ema_next(self._ema_s, price, self.macd_slow)
        return f - s

    def macd_atas(self, price: float) -> bool:
        """MACD atas = bar 0,1,2 semua > 0 (bar0 aproksimasi harga)."""
        m1, m2 = self.val(self.macd, 1), self.val(self.macd, 2)
        if m1 is None or m2 is None:
            return False
        return self.macd_bar0(price) > 0 and m1 > 0 and m2 > 0

    def macd_bawah(self, price: float) -> bool:
        m1, m2 = self.val(self.macd, 1), self.val(self.macd, 2)
        if m1 is None or m2 is None:
            return False
        return self.macd_bar0(price) < 0 and m1 < 0 and m2 < 0

    # ------------------------------------------------------------- donchian
    def highest(self, start_bar: int, count: int):
        """High tertinggi bar start_bar .. start_bar+count-1 (bars-ago)."""
        vals = [self.val(self.h, start_bar + k) for k in range(count)]
        vals = [v for v in vals if v is not None]
        return max(vals) if vals else None

    def lowest(self, start_bar: int, count: int):
        vals = [self.val(self.l, start_bar + k) for k in range(count)]
        vals = [v for v in vals if v is not None]
        return min(vals) if vals else None

    # ------------------------------------------------------------- zona MACD
    def macd_zones(self, sign: int, lookback: int = 53):
        """Segmen kontigu MACD bertanda ``sign`` dalam bar 1..lookback.

        Return list (bar_muda, bar_tua) terurut dari paling baru,
        keduanya dalam satuan bars-ago.
        """
        zones = []
        in_zone = False
        start = None
        for k in range(1, lookback + 1):
            m = self.val(self.macd, k)
            if m is None:
                break
            ok = (m > 0) if sign > 0 else (m < 0)
            if ok and not in_zone:
                in_zone, start = True, k
            elif not ok and in_zone:
                zones.append((start, k - 1))
                in_zone = False
        if in_zone:
            zones.append((start, min(lookback, len(self.c))))
        return zones

    def zone_extreme_high(self, zone) -> float:
        a, b = zone
        return max(self.val(self.h, k) for k in range(a, b + 1))

    def zone_extreme_low(self, zone) -> float:
        a, b = zone
        return min(self.val(self.l, k) for k in range(a, b + 1))

    def zone_fractal_count(self, zone, up: bool) -> int:
        a, b = zone
        arr = self.fract_up if up else self.fract_dn
        n = 0
        for k in range(a, b + 1):
            v = self.val(arr, k)
            if v:
                n += 1
        return n

    # ------------------------------------------------------------- ichimoku
    def ichimoku(self, tenkan_p: int, kijun_p: int, senkou_p: int,
                 bars_ago: int = 1):
        """(tenkan, kijun, spanA, spanB) dibaca di ``bars_ago``.

        Span A/B memakai displacement klasik 26 bar ke depan, sehingga nilai
        awan DI POSISI bar tsb berasal dari perhitungan 26 bar sebelumnya.
        """
        disp = 26
        base = bars_ago
        t = self._hl_mid(tenkan_p, base)
        kj = self._hl_mid(kijun_p, base)
        tb = self._hl_mid(tenkan_p, base + disp)
        kb = self._hl_mid(kijun_p, base + disp)
        span_a = (tb + kb) / 2.0 if (tb is not None and kb is not None) else None
        span_b = self._hl_mid(senkou_p, base + disp)
        return t, kj, span_a, span_b

    def ichimoku_forward(self, tenkan_p: int, kijun_p: int, senkou_p: int):
        """Awan MASA DEPAN dihitung di bar 1 (tanpa displacement) — utk i=9."""
        t = self._hl_mid(tenkan_p, 1)
        kj = self._hl_mid(kijun_p, 1)
        span_a = (t + kj) / 2.0 if (t is not None and kj is not None) else None
        span_b = self._hl_mid(senkou_p, 1)
        return span_a, span_b

    def _hl_mid(self, period: int, start_bar: int):
        hh = self.highest(start_bar, period)
        ll = self.lowest(start_bar, period)
        if hh is None or ll is None:
            return None
        return (hh + ll) / 2.0

    # ------------------------------------------------------------- fraktal
    def last_fractal(self, up: bool, max_lookback: int = 200):
        """Bars-ago fraktal terkonfirmasi terbaru (mulai bar 3)."""
        arr = self.fract_up if up else self.fract_dn
        for k in range(3, max_lookback):
            v = self.val(arr, k)
            if v is None:
                return None
            if v:
                return k
        return None
