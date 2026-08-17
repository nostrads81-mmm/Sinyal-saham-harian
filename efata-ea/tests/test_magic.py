import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from efata.magic import (MagicId, auto_lot, decode_magic, parse_command)


class TestMagicCodec(unittest.TestCase):
    def test_decode_contoh_dokumen(self):
        # contoh dokumen 2c: 1011000.1 -> magic 10110, lot 0.1
        m = decode_magic(10110)
        self.assertEqual((m.i, m.m, m.Z, m.E, m.X), (1, 0, 1, 1, 0))
        self.assertEqual(m.value, 10110)
        self.assertEqual(m.tf_entry, "M1")
        self.assertEqual(m.tf_lawan, "M1")  # X=0 ikut E

    def test_roundtrip(self):
        for magic in (10110, 25341, 90110, 41723 + 10000):
            self.assertEqual(decode_magic(magic).value, magic)

    def test_tf_lawan_x(self):
        m = decode_magic(10125)  # X=5 -> D1
        self.assertEqual(m.tf_lawan, "D1")


class TestParseCommand(unittest.TestCase):
    def test_kontrol(self):
        self.assertEqual(parse_command(95).action, "show_all")
        self.assertEqual(parse_command(94).action, "reset")
        self.assertEqual(parse_command(97).action, "close_all")
        self.assertEqual(parse_command(98).action, "del_all")
        self.assertEqual(parse_command(99).action, "standby")
        c = parse_command(7)
        self.assertEqual((c.action, c.slot), ("show_slot", 7))

    def test_spawn_7_digit(self):
        # dokumen: 1011000.1 -> i=1 m=0 Z=1 E=1 X=0 LL=00 lot 0.1
        c = parse_command(1011000.1)
        self.assertEqual(c.kind, "spawn")
        self.assertEqual(c.magic.value, 10110)
        self.assertAlmostEqual(c.lot, 0.1)

    def test_order_8_digit(self):
        # dokumen 2b: 11511000.1 -> BS magic 15110 lot 0.1
        c = parse_command(11511000.1)
        self.assertEqual((c.kind, c.cmd), ("order", 1))
        self.assertEqual(c.magic.value, 15110)
        self.assertAlmostEqual(c.lot, 0.1)
        # 41723500 -> Sell market magic 17235, lot MM (LL=00)
        c = parse_command(41723500)
        self.assertEqual((c.kind, c.cmd), ("order", 4))
        self.assertEqual(c.magic.value, 17235)
        self.assertEqual(c.lot, 0.0)

    def test_loop_8_digit(self):
        # dokumen 2b: 81011000.1 -> LS Loop magic 10110 lot 0.1
        c = parse_command(81011000.1)
        self.assertEqual((c.kind, c.cmd), ("order", 8))
        self.assertEqual(c.magic.value, 10110)
        self.assertAlmostEqual(c.lot, 0.1)


class TestAutoLot(unittest.TestCase):
    def test_rumus_mm(self):
        # balance * MM / 100.000 (dokumen 2b)
        self.assertAlmostEqual(auto_lot(10_000, 1.0), 0.1)
        self.assertAlmostEqual(auto_lot(100_000, 1.0), 1.0)
        self.assertAlmostEqual(auto_lot(100_000, 2.0), 2.0)
        self.assertAlmostEqual(auto_lot(500, 1.0), 0.01)  # minimum


if __name__ == "__main__":
    unittest.main()
