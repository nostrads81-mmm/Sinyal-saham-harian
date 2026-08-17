"""29 parameter LS Param (slot 1-29) sesuai dokumen EfataTech EA v26.07.29.

Di MT5 nilai-nilai ini diedit live lewat kolom TP order LS Param
(magic 55555, harga 100001-100029). Di replika Python parameter dipegang
langsung sebagai atribut; ``set_slot``/``get_slot`` meniru mekanisme
live-edit per nomor slot.
"""

from dataclasses import dataclass, field, fields


@dataclass
class Params:
    # slot : nama            default   (fungsi ringkas, lihat README)
    exitPct: float = 0.0        # 1  tutup magic bila profit floating > X% balance (0=off)
    exitUSD: float = 100.0      # 2  tutup SEMUA bila total profit > USD ini (0=off)
    xLot: float = 1.0           # 3  pengali lot martingale (>1) / mode pasangan (=1)
    lossMaxUSD: float = 0.0     # 4  tutup magic bila rugi > USD ini (0=off)
    lossMaxPersen: float = 25.0 # 5  tutup magic bila rugi > X% balance (0=off)
    minMarginLev: float = 5000  # 6  margin level < ini -> semua BS/SS diparkir (0=off)
    xLotLinier: float = 0.0     # 7  >0 = lot linier init*(level+1)*nilai
    useRSI: float = 0.0         # 8  filter RSI L0: 0=off, 1-7=digit TF
    exitRR: float = 2.0         # 9  X.Y: tutup magic bila profit > RR x rugi terburuk, mulai level Y
    exitBid: float = 0.0        # 10 Bid > nilai -> close all (0=off)
    exitBidMin: float = 0.0     # 11 Bid < nilai -> close all (0=off)
    loopPerDay: float = 0.0     # 12 batas restart LS Loop per hari (0=tanpa batas)
    startTrade: float = 0.0     # 13 jam mulai trading WIB (0-23)
    endTrade: float = 24.0      # 14 jam akhir trading WIB (24=24/7)
    wibOffset: float = 7.0      # 15 offset jam broker -> WIB
    TR: float = 1.0             # 16 1=update harga lawan tiap detik, 0=isi 1x saat open
    MM: float = 1.0             # 17 lot per 100k balance (dipakai bila LL=0)
    useDivergent: float = 0.0   # 18 1=update target pakai divergensi MACD (0=off)
    nextRound: float = 0.0      # 19 X.Y: auto-spawn magic m+1 di level X, total Y ronde
    useEMA: float = 0.0         # 20 >0=period EMA filter target BS/SS (0=off)
    addTemen: float = 2.0       # 21 maks order teman -T
    maxLevel: float = 0.0       # 22 batas level Lx (0=off)
    maxLevCut: float = 2.0      # 23 level cut: capai Lx -> close-by semua magic (0=off)
    atrBuf: float = 0.4         # 24 [i=6] buffer target = (atrBuf+0.15*level)*ATR
    minADX: float = 20.0        # 25 [i=6] ADX bar1 < ini -> target hanya boleh menjauh
    booster1: float = 0.0       # 26 X.Y: di level X, lot = induk*xLot*(1+0.Y)
    booster2: float = 0.0       # 27 booster level ke-2
    booster3: float = 0.0       # 28 booster level ke-3
    lotTeman: float = 0.0       # 29 pengali lot order -T (0=samakan open asli)

    def __post_init__(self):
        self._defaults = {f.name: getattr(self, f.name) for f in fields(self)}

    # --- peniruan slot LS Param -------------------------------------------
    SLOT_NAMES = (
        "exitPct", "exitUSD", "xLot", "lossMaxUSD", "lossMaxPersen",
        "minMarginLev", "xLotLinier", "useRSI", "exitRR", "exitBid",
        "exitBidMin", "loopPerDay", "startTrade", "endTrade", "wibOffset",
        "TR", "MM", "useDivergent", "nextRound", "useEMA", "addTemen",
        "maxLevel", "maxLevCut", "atrBuf", "minADX", "booster1", "booster2",
        "booster3", "lotTeman",
    )

    def set_slot(self, slot: int, value: float) -> None:
        """Ubah parameter lewat nomor slot 1-29 (padanan edit TP LS Param)."""
        if not 1 <= slot <= 29:
            raise ValueError(f"slot LS Param harus 1-29, dapat {slot}")
        setattr(self, self.SLOT_NAMES[slot - 1], float(value))

    def get_slot(self, slot: int) -> float:
        if not 1 <= slot <= 29:
            raise ValueError(f"slot LS Param harus 1-29, dapat {slot}")
        return getattr(self, self.SLOT_NAMES[slot - 1])

    def reset_defaults(self) -> None:
        """Perintah TP=94: kembalikan semua parameter ke default input."""
        for name, val in self._defaults.items():
            setattr(self, name, val)

    # --- helper decoding gabungan X.Y -------------------------------------
    @staticmethod
    def split_xy(value: float):
        """Pecah encoding X.Y (exitRR, nextRound, booster): (int X, frac Y)."""
        x = int(value)
        frac = round(value - x, 4)
        return x, frac

    def booster_multiplier(self, level: int) -> float:
        """Pengali booster utk level tsb: 1.0 bila tak ada booster level itu.

        boosterN = X.Y -> di level X lot dikali (1 + 0.Y). Contoh 3.35 ->
        level 3 dikali 1.35 (dokumen bagian 7).
        """
        for b in (self.booster1, self.booster2, self.booster3):
            if b > 0:
                lvl, frac = self.split_xy(b)
                if lvl == level:
                    return 1.0 + frac
        return 1.0
