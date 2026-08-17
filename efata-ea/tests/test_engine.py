import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from efata.broker import SimBroker, SymbolSpec
from efata.data import synthetic
from efata.engine import Engine, STANDBY_BS, STANDBY_SS
from efata.indicators import Bar
from efata.params import Params


def build(magic=10110, lot=0.01, warm_bars=80, seed=2, **overrides):
    p = Params()
    for k, v in overrides.items():
        setattr(p, k, v)
    b = SimBroker(SymbolSpec(), balance=10_000.0)
    eng = Engine(b, p)
    eng.spawn(magic, lot)
    for bar in synthetic(warm_bars, seed=seed):
        eng.on_bar_m1(bar)
        b.set_price(bar.c, bar.time)
    return eng, b


class TestSeedDanLawan(unittest.TestCase):
    def test_seed_pasangan_siaga(self):
        eng, b = build()
        eng.step()
        self.assertEqual(len(b.pendings_of(10110, "BS")), 1)
        self.assertEqual(len(b.pendings_of(10110, "SS")), 1)

    def test_marti_lawan_x3(self):
        eng, b = build(xLot=3.0)
        b.market(10110, +1, 0.01)            # open buy L0
        eng.step()
        ss = b.pendings_of(10110, "SS")
        self.assertEqual(len(ss), 1)
        self.assertAlmostEqual(ss[0].lot, 0.03)   # lawan = 0.01 * 3
        self.assertEqual(b.pendings_of(10110, "BS"), [])  # BS dihapus

    def test_terkunci_1_1_diam(self):
        # dokumen: lot buy == lot sell -> DIAM (anti loop hapus-buat)
        eng, b = build(xLot=3.0)
        b.market(10110, +1, 0.03)
        b.market(10110, -1, 0.03)
        eng.step()
        before = {pid: (p.ptype, p.lot, p.price)
                  for pid, p in b.pendings.items()}
        eng.step()
        after = {pid: (p.ptype, p.lot, p.price)
                 for pid, p in b.pendings.items()}
        self.assertEqual(before, after)      # tidak ada hapus-buat order

    def test_pasangan_pending_lot_awal(self):
        eng, b = build(xLot=1.0)
        b.market(10110, +1, 0.01)
        b.market(10110, -1, 0.01)            # terkunci penuh L0
        eng.step()
        bs = b.pendings_of(10110, "BS")
        ss = b.pendings_of(10110, "SS")
        self.assertEqual(len(bs), 1)
        self.assertEqual(len(ss), 1)
        self.assertAlmostEqual(bs[0].lot, 0.01)  # lot awal, tidak membesar
        self.assertAlmostEqual(ss[0].lot, 0.01)


class TestPengaman(unittest.TestCase):
    def test_max_lev_cut_marti(self):
        eng, b = build(xLot=3.0, maxLevCut=2.0)
        b.market(10110, +1, 0.09)            # lot level 2
        eng.step()
        self.assertEqual(b.positions_of(10110), [])   # dipotong

    def test_max_lev_cut_pasangan_saat_terkunci(self):
        eng, b = build(xLot=1.0, maxLevCut=2.0)
        for _ in range(2):                   # 2 pasangan terkunci penuh
            b.market(10110, +1, 0.01)
            b.market(10110, -1, 0.01)
        eng.step()
        self.assertEqual(b.positions_of(10110), [])

    def test_max_level_parkir_pending(self):
        eng, b = build(xLot=3.0, maxLevel=2.0, maxLevCut=0.0)
        b.market(10110, +1, 0.09)            # level 2 tercapai
        eng.step()
        pendings = b.pendings_of(10110)
        self.assertTrue(pendings)
        self.assertTrue(all(p.parked for p in pendings))  # rem 99

    def test_min_margin_parkir(self):
        eng, b = build(minMarginLev=1e9)     # threshold mustahil tinggi
        b.market(10110, +1, 1.0)
        eng.step()
        for p in b.pendings.values():
            self.assertTrue(p.parked)


class TestExit(unittest.TestCase):
    def test_exit_pct_magic(self):
        eng, b = build(exitPct=1.0, exitUSD=0.0)
        pos = b.market(10110, +1, 1.0)
        b.set_price(b.bid + 2.0)             # profit 1 lot * 100 * 2.0 = ~200
        eng.step()
        self.assertEqual(b.positions_of(10110), [])
        self.assertGreater(b.balance, 10_000.0)

    def test_exit_usd_global(self):
        eng, b = build(exitUSD=100.0)
        b.market(10110, +1, 1.0)
        b.set_price(b.bid + 2.0)
        eng.step()
        self.assertEqual(len(b.positions), 0)

    def test_loss_max_persen(self):
        eng, b = build(lossMaxPersen=5.0, exitRR=0.0)
        b.market(10110, +1, 1.0)
        b.set_price(b.bid - 6.0)             # rugi ~600 > 5% dari 10k
        eng.step()
        self.assertEqual(b.positions_of(10110), [])
        self.assertLess(b.balance, 10_000.0)

    def test_exit_bid(self):
        eng, b = build(exitBid=1.0)          # bid pasti > 1 -> tutup semua
        b.market(10110, +1, 0.1)
        eng.step()
        self.assertEqual(len(b.positions), 0)


class TestPerintah(unittest.TestCase):
    def test_spawn_dan_order_langsung(self):
        eng, b = build()
        eng.execute(1011000.1)               # spawn magic 10110 lot 0.1
        self.assertIn(10110, eng.magics)
        self.assertAlmostEqual(eng.magics[10110].init_lot, 0.1)
        eng.execute(31511000.1)              # buy market magic 15110
        self.assertEqual(len(b.positions_of(15110)), 1)

    def test_close_all_97(self):
        eng, b = build()
        b.market(10110, +1, 0.1)
        b.place_pending(10110, "BS", 0.1, STANDBY_BS, enforce_stops=False)
        eng.execute(97)                      # tutup posisi, pending tetap
        self.assertEqual(len(b.positions), 0)
        self.assertEqual(len(b.pendings), 1)
        eng.execute(98)                      # hapus semua
        self.assertEqual(len(b.pendings), 0)

    def test_reset_94(self):
        eng, b = build()
        eng.params.xLot = 9.0
        eng.execute(94)
        self.assertEqual(eng.params.xLot, 1.0)


class TestJamTrading(unittest.TestCase):
    def test_di_luar_jam_tidak_seed(self):
        # broker jam 00:00 + offset 7 -> WIB 07:00; izinkan hanya 10-12 WIB
        eng, b = build(startTrade=10.0, endTrade=12.0, wibOffset=7.0)
        b.time = datetime(2025, 1, 6, 0, 0)
        eng.step()
        self.assertEqual(b.pendings_of(10110), [])
        b.time = datetime(2025, 1, 6, 4, 0)  # WIB 11 -> boleh
        eng.step()
        self.assertEqual(len(b.pendings_of(10110)), 2)


class TestSmokeSemuaTeknik(unittest.TestCase):
    def test_backtest_9_teknik_jalan(self):
        from efata.backtest import Backtester
        for i in range(1, 10):
            magic = i * 10000 + 110
            bt = Backtester(params=Params(xLot=3.0, exitPct=1.0))
            bt.engine.spawn(magic, 0.01)
            stats = bt.run(synthetic(1500, seed=i))
            self.assertEqual(stats.bars, 1500 - 60, f"i={i}")
            self.assertGreater(bt.broker.equity, 0, f"i={i}")

    def test_pasangan_mode_smoke(self):
        from efata.backtest import Backtester
        bt = Backtester(params=Params(xLot=1.0, exitPct=1.0, maxLevCut=3.0))
        bt.engine.spawn(10110, 0.01)
        stats = bt.run(synthetic(2000, seed=11))
        self.assertGreater(bt.broker.equity, 0)


if __name__ == "__main__":
    unittest.main()
