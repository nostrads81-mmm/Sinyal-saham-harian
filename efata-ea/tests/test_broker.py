import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from efata.broker import SimBroker, SymbolSpec


def broker(bid=2400.0):
    b = SimBroker(SymbolSpec(), balance=10_000.0)
    b.set_price(bid, datetime(2025, 1, 6, 10, 0))
    return b


class TestPendingTrigger(unittest.TestCase):
    def test_bs_trigger(self):
        b = broker(2400.0)
        b.place_pending(1, "BS", 0.10, 2405.0)
        b.set_price(2404.0)
        self.assertEqual(len(b.positions), 0)
        b.set_price(2405.0)   # ask = 2405.2 >= 2405 -> trigger
        self.assertEqual(len(b.positions), 1)
        pos = next(iter(b.positions.values()))
        self.assertEqual(pos.dir, 1)
        self.assertAlmostEqual(pos.open_price, 2405.0)

    def test_ss_trigger(self):
        b = broker(2400.0)
        b.place_pending(1, "SS", 0.10, 2395.0)
        b.set_price(2396.0)
        self.assertEqual(len(b.positions), 0)
        b.set_price(2394.9)
        self.assertEqual(len(b.positions), 1)
        self.assertEqual(next(iter(b.positions.values())).dir, -1)

    def test_parked_tidak_trigger(self):
        # padanan "rem 99": pending parked tidak diproses
        b = broker(2400.0)
        p = b.place_pending(1, "BS", 0.10, 2405.0)
        p.parked = True
        b.set_price(2410.0)
        self.assertEqual(len(b.positions), 0)

    def test_stops_level(self):
        b = broker(2400.0)
        with self.assertRaises(ValueError):
            b.place_pending(1, "BS", 0.1, b.ask + 0.01)  # terlalu dekat


class TestProfitDanCloseBy(unittest.TestCase):
    def test_profit_buy(self):
        b = broker(2400.0)
        pos = b.market(1, +1, 1.0)          # buy di ask 2400.2
        b.set_price(2401.2)                  # bid naik 1.0
        self.assertAlmostEqual(b.profit(pos), (2401.2 - 2400.2) * 100 * 1.0)

    def test_close_by_tanpa_spread(self):
        b = broker(2400.0)
        buy = b.market(1, +1, 1.0)           # ask 2400.2
        b.set_price(2398.0)
        sell = b.market(1, -1, 1.0)          # bid 2398.0
        profit = b.close_by(buy.id, sell.id)
        # (sell_open - buy_open) * contract * lot, tanpa spread lagi
        self.assertAlmostEqual(profit, (2398.0 - 2400.2) * 100 * 1.0)
        self.assertEqual(len(b.positions), 0)

    def test_close_by_lot_beda_sisakan_lot(self):
        b = broker(2400.0)
        buy = b.market(1, +1, 0.30)
        sell = b.market(1, -1, 0.10)
        b.close_by(buy.id, sell.id)
        self.assertEqual(len(b.positions), 1)
        rest = next(iter(b.positions.values()))
        self.assertEqual(rest.dir, 1)
        self.assertAlmostEqual(rest.lot, 0.20)

    def test_close_all_magic(self):
        b = broker(2400.0)
        b.market(7, +1, 0.1)
        b.market(7, -1, 0.3)
        b.market(8, +1, 0.1)                 # magic lain tak tersentuh
        b.place_pending(7, "BS", 0.1, 2410.0)
        b.close_all_magic(7)
        self.assertEqual(len(b.positions_of(7)), 0)
        self.assertEqual(len(b.pendings_of(7)), 0)
        self.assertEqual(len(b.positions_of(8)), 1)

    def test_equity_dan_margin(self):
        b = broker(2400.0)
        self.assertEqual(b.equity, 10_000.0)
        b.market(1, +1, 1.0)
        self.assertLess(b.equity, 10_000.0)  # kena spread
        self.assertGreater(b.margin(), 0)
        self.assertLess(b.margin_level(), float("inf"))


if __name__ == "__main__":
    unittest.main()
