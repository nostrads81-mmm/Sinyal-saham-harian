import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from efata.broker import SimBroker, SymbolSpec
from efata.engine import Engine, MagicConfig
from efata.magic import decode_magic
from efata.params import Params


def make_engine(**overrides):
    p = Params()
    for k, v in overrides.items():
        setattr(p, k, v)
    eng = Engine(SimBroker(SymbolSpec()), p)
    eng.spawn(10110, 0.01)
    return eng, eng.magics[10110]


class TestTanggaLot(unittest.TestCase):
    def test_marti_x3_sesuai_tabel_dokumen(self):
        # dokumen bagian 6: init 0.01, xLot=3 -> L0..L5 = 0.01 .. 2.43
        eng, cfg = make_engine(xLot=3.0)
        expect = [0.01, 0.03, 0.09, 0.27, 0.81, 2.43]
        for lvl, want in enumerate(expect):
            self.assertAlmostEqual(eng.ladder_lot(cfg, lvl), want)

    def test_level_dari_lot(self):
        eng, cfg = make_engine(xLot=3.0)
        for lvl in range(6):
            lot = eng.ladder_lot(cfg, lvl)
            self.assertEqual(eng.level_from_lot(cfg, lot), lvl)

    def test_linier(self):
        # xLotLinier: lot Lx = init * (x+1) * nilai (dokumen bagian 6)
        eng, cfg = make_engine(xLotLinier=2.0)
        self.assertAlmostEqual(eng.ladder_lot(cfg, 0), 0.02)
        self.assertAlmostEqual(eng.ladder_lot(cfg, 1), 0.04)
        self.assertAlmostEqual(eng.ladder_lot(cfg, 4), 0.10)

    def test_pasangan_lot_rata(self):
        eng, cfg = make_engine(xLot=1.0)
        for lvl in range(6):
            self.assertAlmostEqual(eng.ladder_lot(cfg, lvl), 0.01)


class TestBooster(unittest.TestCase):
    def test_contoh_dokumen(self):
        # dokumen bagian 7: 3.35 -> level 3 dikali 1.35
        p = Params(booster1=3.35, booster2=5.3, booster3=8.3)
        self.assertAlmostEqual(p.booster_multiplier(3), 1.35)
        self.assertAlmostEqual(p.booster_multiplier(5), 1.30)
        self.assertAlmostEqual(p.booster_multiplier(8), 1.30)
        self.assertAlmostEqual(p.booster_multiplier(2), 1.0)

    def test_default_mati(self):
        p = Params()
        for lvl in range(10):
            self.assertAlmostEqual(p.booster_multiplier(lvl), 1.0)

    def test_booster_mengalikan_xlot(self):
        # lot = induk * xLot * (1 + 0.Y), bukan menggantikan
        eng, cfg = make_engine(xLot=3.0, booster1=3.35)
        self.assertAlmostEqual(eng.ladder_lot(cfg, 3), round(0.27 * 1.35, 2))
        self.assertAlmostEqual(eng.ladder_lot(cfg, 2), 0.09)


class TestLotTeman(unittest.TestCase):
    def test_piramida_mengecil(self):
        # dokumen bagian 8: open 1.0, lotTeman 0.7 -> 0.70, 0.49, 0.34
        spec = SymbolSpec()
        open_asli, lt = 1.0, 0.7
        lots = [spec.norm_lot(open_asli * lt ** n) for n in (1, 2, 3)]
        self.assertEqual(lots, [0.7, 0.49, 0.34])


class TestParams(unittest.TestCase):
    def test_slot_mapping(self):
        p = Params()
        p.set_slot(3, 3.0)
        self.assertEqual(p.xLot, 3.0)
        p.set_slot(23, 5)
        self.assertEqual(p.maxLevCut, 5.0)
        self.assertEqual(p.get_slot(9), 2.0)   # exitRR default
        self.assertEqual(len(Params.SLOT_NAMES), 29)

    def test_reset_default(self):
        p = Params()
        p.set_slot(3, 9.0)
        p.set_slot(21, 7.0)
        p.reset_defaults()
        self.assertEqual(p.xLot, 1.0)
        self.assertEqual(p.addTemen, 2.0)

    def test_split_xy(self):
        self.assertEqual(Params.split_xy(2.0), (2, 0.0))
        x, y = Params.split_xy(3.35)
        self.assertEqual(x, 3)
        self.assertAlmostEqual(y, 0.35)


if __name__ == "__main__":
    unittest.main()
