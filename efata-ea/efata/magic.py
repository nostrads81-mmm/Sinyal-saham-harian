"""Format magic imZEX (5 digit) dan parser perintah LS Kendali.

magic = i*10000 + m*1000 + Z*100 + E*10 + X
  i = teknik 1-9, m = pembeda 0-9,
  Z = TF filter arah besar (MACD Z), E = TF entry/fraktal, X = TF lawan (0=ikut E).
Peta digit TF: 1=M1 2=M5 3=M30 4=H4 5=D1 6=W1 7=MN1.
"""

from dataclasses import dataclass

TF_MAP = {1: "M1", 2: "M5", 3: "M30", 4: "H4", 5: "D1", 6: "W1", 7: "MN1"}
TF_MINUTES = {"M1": 1, "M5": 5, "M30": 30, "H4": 240, "D1": 1440, "W1": 10080, "MN1": 43200}

MAGIC_LS_KENDALI = 900000
MAGIC_LS_LOOP = 88888
MAGIC_LS_PARAM = 55555


@dataclass(frozen=True)
class MagicId:
    i: int  # teknik 1-9
    m: int  # pembeda 0-9
    Z: int  # digit TF filter arah
    E: int  # digit TF entry
    X: int  # digit TF lawan (0 = ikut E)

    @property
    def value(self) -> int:
        return self.i * 10000 + self.m * 1000 + self.Z * 100 + self.E * 10 + self.X

    @property
    def tf_entry(self) -> str:
        return TF_MAP[self.E]

    @property
    def tf_filter(self) -> str:
        return TF_MAP.get(self.Z, TF_MAP[self.E])

    @property
    def tf_lawan(self) -> str:
        return TF_MAP[self.X] if self.X else TF_MAP[self.E]


def decode_magic(magic: int) -> MagicId:
    if not 10000 <= magic <= 99999:
        raise ValueError(f"magic imZEX harus 5 digit, dapat {magic}")
    i, rest = divmod(magic, 10000)
    m, rest = divmod(rest, 1000)
    Z, rest = divmod(rest, 100)
    E, X = divmod(rest, 10)
    if not 1 <= i <= 9:
        raise ValueError(f"digit teknik i harus 1-9, dapat {i}")
    if E not in TF_MAP:
        raise ValueError(f"digit TF E tidak dikenal: {E}")
    if Z and Z not in TF_MAP:
        raise ValueError(f"digit TF Z tidak dikenal: {Z}")
    if X and X not in TF_MAP:
        raise ValueError(f"digit TF X tidak dikenal: {X}")
    return MagicId(i, m, Z, E, X)


@dataclass
class Command:
    """Hasil parse angka TP LS Kendali (dokumen bagian 2)."""

    kind: str            # 'control' | 'spawn' | 'order'
    action: str = ""     # control: 'show_slot','reset','show_all','del_param','close_all','del_all','standby'
    slot: int = 0        # control show_slot 1-25
    cmd: int = 0         # order: 1=BS 2=SS 3=buy mkt 4=sell mkt 8=LS Loop
    magic: MagicId = None
    lot: float = 0.0     # 0 = pakai MM (lot otomatis dari balance)


def _lot_from_ll(ll: int, frac: float) -> float:
    """LL 2 digit + fraksi. LL=00 tanpa fraksi -> 0 (lot otomatis MM)."""
    return round(ll + frac, 4)


def parse_command(tp: float) -> Command:
    """Baca angka TP LS Kendali berdasarkan jumlah digit bagian bulat."""
    if tp <= 0:
        raise ValueError("TP LS Kendali harus > 0")
    whole = int(round(tp // 1))
    frac = round(tp - whole, 4)
    digits = len(str(whole))

    if digits <= 2:
        w = whole
        if 1 <= w <= 25:
            return Command("control", "show_slot", slot=w)
        mapping = {94: "reset", 95: "show_all", 96: "del_param",
                   97: "close_all", 98: "del_all", 99: "standby"}
        if w in mapping:
            return Command("control", mapping[w])
        raise ValueError(f"perintah kontrol tidak dikenal: {w}")

    if digits == 3:  # E LL : teknik 1 default, mm=10 default
        e, ll = divmod(whole, 100)
        return Command("spawn", magic=MagicId(1, 0, 1, e, 0), lot=_lot_from_ll(ll, frac))

    if digits == 5:  # Z E X LL : mm=10 default
        z, rest = divmod(whole, 10000)
        e, rest = divmod(rest, 1000)
        x, ll = divmod(rest, 100)
        return Command("spawn", magic=MagicId(1, 0, z, e, x), lot=_lot_from_ll(ll, frac))

    if digits == 7:  # mm Z E X LL
        mm, rest = divmod(whole, 100000)
        z, rest = divmod(rest, 10000)
        e, rest = divmod(rest, 1000)
        x, ll = divmod(rest, 100)
        i, m = divmod(mm, 10)
        return Command("spawn", magic=MagicId(i, m, z, e, x), lot=_lot_from_ll(ll, frac))

    if digits == 8:  # [cmd][mm][Z][E][X][LL]
        c, rest = divmod(whole, 10000000)
        mm, rest = divmod(rest, 100000)
        z, rest = divmod(rest, 10000)
        e, rest = divmod(rest, 1000)
        x, ll = divmod(rest, 100)
        i, m = divmod(mm, 10)
        if c not in (1, 2, 3, 4, 8):
            raise ValueError(f"cmd order 8-digit tidak dikenal: {c}")
        return Command("order", cmd=c, magic=MagicId(i, m, z, e, x),
                       lot=_lot_from_ll(ll, frac))

    raise ValueError(f"jumlah digit TP tidak dikenal: {digits} ({tp})")


def auto_lot(balance: float, mm: float, lot_step: float = 0.01,
             lot_min: float = 0.01) -> float:
    """Lot otomatis bila LL=00: balance * MM / 100.000 (dokumen 2b)."""
    lot = balance * mm / 100_000.0
    steps = int(lot / lot_step + 1e-9)
    return max(lot_min, round(steps * lot_step, 2))
