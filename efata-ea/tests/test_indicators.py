import math
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from efata.data import TFAggregator, synthetic
from efata.indicators import Bar, IndicatorSet


def feed(ind, closes, spread=0.5):
    t = datetime(2025, 1, 6)
    for c in closes:
        ind.add_bar(Bar(t, c, c + spread, c - spread, c))
        t += timedelta(minutes=1)


class TestIndicators(unittest.TestCase):
    def test_macd_tanda_tren(self):
        ind = IndicatorSet()
        feed(ind, [100 + i for i in range(60)])          # naik terus
        self.assertGreater(ind.val(ind.macd, 1), 0)
        ind2 = IndicatorSet()
        feed(ind2, [200 - i for i in range(60)])         # turun terus
        self.assertLess(ind2.val(ind2.macd, 1), 0)

    def test_macd_atas_bawah(self):
        ind = IndicatorSet()
        feed(ind, [100 + i for i in range(60)])
        self.assertTrue(ind.macd_atas(165.0))
        self.assertFalse(ind.macd_bawah(165.0))

    def test_rsi_batas(self):
        ind = IndicatorSet()
        feed(ind, [100 + i * 0.3 for i in range(100)])
        r = ind.val(ind.rsi, 1)
        self.assertTrue(50 < r <= 100)
        for b in synthetic(300, seed=7):
            pass
        ind2 = IndicatorSet()
        for b in synthetic(300, seed=7):
            ind2.add_bar(b)
        for v in ind2.rsi:
            self.assertTrue(0 <= v <= 100)

    def test_atr_positif(self):
        ind = IndicatorSet()
        for b in synthetic(200, seed=3):
            ind.add_bar(b)
        self.assertGreater(ind.val(ind.atr, 1), 0)

    def test_fractal_puncak(self):
        ind = IndicatorSet()
        closes = [100, 101, 102, 105, 102, 101, 100, 99, 98]
        feed(ind, closes, spread=0.1)
        # puncak di indeks 3 (105) terkonfirmasi setelah 2 bar berikutnya
        self.assertTrue(ind.fract_up[3])
        k = ind.last_fractal(up=True)
        self.assertEqual(len(ind.c) - k, 3)

    def test_donchian(self):
        ind = IndicatorSet()
        feed(ind, [100, 110, 105, 120, 90, 95], spread=0.0)
        self.assertAlmostEqual(ind.highest(1, 5), 120)
        self.assertAlmostEqual(ind.lowest(1, 5), 90)

    def test_zona_macd(self):
        ind = IndicatorSet()
        closes = ([100 + i for i in range(30)] +          # naik: MACD atas
                  [130 - i for i in range(30)])           # turun: MACD bawah
        feed(ind, closes)
        zones_up = ind.macd_zones(+1)
        self.assertTrue(zones_up)
        a, b = zones_up[0]
        self.assertLessEqual(a, b)
        # ekstrem zona atas harus dekat puncak deret (130)
        self.assertGreater(ind.zone_extreme_high(zones_up[0]), 120)


class TestAggregator(unittest.TestCase):
    def test_m5(self):
        agg = TFAggregator("M5")
        t = datetime(2025, 1, 6, 10, 0)
        closed = []
        for i in range(11):
            bar = Bar(t + timedelta(minutes=i), 100 + i, 101 + i, 99 + i, 100.5 + i)
            out = agg.feed(bar)
            if out:
                closed.append(out)
        self.assertEqual(len(closed), 2)
        b0 = closed[0]
        self.assertEqual(b0.time.minute, 0)
        self.assertEqual(b0.o, 100)
        self.assertEqual(b0.h, 101 + 4)
        self.assertEqual(b0.c, 100.5 + 4)


if __name__ == "__main__":
    unittest.main()
