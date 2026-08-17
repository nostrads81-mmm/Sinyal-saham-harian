"""Teknik i=1-9: rumus "update target" BS/SS (dokumen bagian 5).

Pemetaan digit i mengikuti tabel bagian 5 dokumen (efatatech.mq5 penuh):
  1 zona MACD polos            6 zona MACD >=2 fraktal + ATR/ADX
  2 zona MACD >=2 fraktal      7 chop-guard breakout (basis polos)
  3 Turtle Donchian            8 Ichimoku Kijun (entry market)
  4 lot-sama high/low 3 bar    9 awan depan + RSI marti balik-arah
  5 polos + konversi cross ke market

Catatan: dokumen bagian 11 (simple1-9) memakai penomoran yang sedikit
berbeda (simple1=fraktal, simple2=lot-sama, simple4=polos, simple5=
Donchian+marti). Detail implementasi di sini diambil dari prompt simple
yang sesuai tekniknya; pemetaan digit bisa ditukar lewat
``Engine(technique_map=...)`` bila nanti terbukti EA asli memakai urutan
lain.
"""

from dataclasses import dataclass

from .indicators import IndicatorSet


@dataclass
class TargetPlan:
    bs: float = None            # harga target BS; None = jangan geser
    ss: float = None
    bs_away_only: bool = False  # target hanya boleh menjauh dari harga
    ss_away_only: bool = False
    convert_bs: bool = False    # i=5: konversi semua BS -> buy market
    convert_ss: bool = False
    cut: bool = False           # i=7: potong sideways (tutup semua magic)


def _zone_target(ind: IndicatorSet, up: bool, need_fractals: int,
                 fallback: bool, lookback: int = 53):
    """Ekstrem zona MACD searah; ``fallback`` = mundur ke zona lebih lama."""
    zones = ind.macd_zones(+1 if up else -1, lookback)
    for z in zones:
        a, b = z
        ok = (b - a + 1) >= 3
        if ok and need_fractals:
            ok = ind.zone_fractal_count(z, up) >= need_fractals
        if ok:
            return ind.zone_extreme_high(z) if up else ind.zone_extreme_low(z)
        if not fallback:
            return None
    return None


def _macd_targets(ind: IndicatorSet, bid: float, need_fractals: int,
                  fallback: bool) -> TargetPlan:
    """Kerangka bersama teknik zona MACD: gate arah + ekstrem zona."""
    plan = TargetPlan()
    # BS hanya digeser saat MACD bawah; targetnya ekstrem zona ATAS
    if ind.macd_bawah(bid):
        plan.bs = _zone_target(ind, True, need_fractals, fallback)
    if ind.macd_atas(bid):
        plan.ss = _zone_target(ind, False, need_fractals, fallback)
    return plan


# --------------------------------------------------------------- teknik 1-7
def target_i1(ctx) -> TargetPlan:
    """Zona MACD polos: zona terakhir saja, >=3 bar, tanpa fraktal."""
    return _macd_targets(ctx.ind_e, ctx.bid, need_fractals=0, fallback=False)


def target_i2(ctx) -> TargetPlan:
    """Zona MACD >=3 bar dan >=2 fraktal, mundur ke zona lama bila perlu."""
    return _macd_targets(ctx.ind_e, ctx.bid, need_fractals=2, fallback=True)


def target_i4(ctx) -> TargetPlan:
    """Lot-sama: target ekstrem 3 bar terakhir, selalu digeser tanpa gate."""
    ind = ctx.ind_e
    return TargetPlan(bs=ind.highest(1, 3), ss=ind.lowest(1, 3))


def target_i5(ctx) -> TargetPlan:
    """Seperti i=1 + konversi cross MACD ke market (dokumen bagian 5)."""
    plan = target_i1(ctx)
    ind = ctx.ind_e
    m1, m2 = ind.val(ind.macd, 1), ind.val(ind.macd, 2)
    if m1 is not None and m2 is not None:
        if m2 < 0 and m1 > 0:
            plan.convert_bs = True   # semua BS Lx -> buy market
        if m2 > 0 and m1 < 0:
            plan.convert_ss = True
    return plan


def target_i6(ctx) -> TargetPlan:
    """i=2 + buffer ATR (atrBuf+0.15*level)*ATR + gerbang ADX."""
    plan = target_i2(ctx)
    ind = ctx.ind_e
    atr = ind.val(ind.atr, 1)
    if ctx.params.atrBuf > 0 and atr:
        buf = (ctx.params.atrBuf + 0.15 * ctx.level) * atr
        if plan.bs is not None:
            plan.bs += buf
        if plan.ss is not None:
            plan.ss = max(ctx.spec.point, plan.ss - buf)
    adx = ind.val(ind.adx, 1)
    if ctx.params.minADX > 0 and adx is not None and adx < ctx.params.minADX:
        plan.bs_away_only = True
        plan.ss_away_only = True
    return plan


def is_sideways(ind: IndicatorSet, adx_gate: float = 20.0) -> bool:
    """i=7: sideways = range 20 bar < 3*ATR DAN ADX bar1 < gate.

    Data gagal dibaca -> BUKAN sideways (konservatif, sesuai prompt).
    """
    hh, ll = ind.highest(1, 20), ind.lowest(1, 20)
    atr, adx = ind.val(ind.atr, 1), ind.val(ind.adx, 1)
    if None in (hh, ll, atr, adx) or atr <= 0:
        return False
    return (hh - ll) < 3.0 * atr and adx < adx_gate


def target_i7(ctx) -> TargetPlan:
    """Chop-guard: basis polos + potong tangga & dorong target keluar range."""
    plan = target_i1(ctx)
    ind = ctx.ind_e
    if is_sideways(ind, ctx.params.minADX or 20.0):
        if ctx.level >= 2:
            plan.cut = True
            return plan
        hh, ll = ind.highest(1, 20), ind.lowest(1, 20)
        atr = ind.val(ind.atr, 1) or 0.0
        floor_bs = hh + 0.5 * atr
        cap_ss = ll - 0.5 * atr
        plan.bs = max(plan.bs, floor_bs) if plan.bs is not None else floor_bs
        plan.ss = min(plan.ss, cap_ss) if plan.ss is not None else cap_ss
        plan.bs_away_only = True
        plan.ss_away_only = True
    return plan


TARGET_FUNCS = {1: target_i1, 2: target_i2, 4: target_i4, 5: target_i5,
                6: target_i6, 7: target_i7}


# --------------------------------------------------------------- teknik 8
def kijun_reference(ind: IndicatorSet, bid: float, point: float,
                    safe_points: float = 70.0):
    """Acuan geser lawan i=8 (prompt simple8): kijun / kumo / swing 13 bar.

    Return (ref_bs, ref_ss) atau (None, None) bila data belum cukup.
    """
    _, kijun, span_a, span_b = ind.ichimoku(5, 13, 26, 1)
    if kijun is None:
        return None, None
    if abs(bid - kijun) >= 200 * point:
        return kijun, kijun
    atap = max(span_a, span_b) if None not in (span_a, span_b) else None
    dasar = min(span_a, span_b) if None not in (span_a, span_b) else None
    safe = safe_points * point

    ref_bs = kijun
    if atap is not None and atap > bid + safe:
        ref_bs = atap
    else:
        swing_h = ind.highest(1, 13)
        if swing_h is not None and swing_h > bid + safe:
            ref_bs = swing_h

    ref_ss = kijun
    if dasar is not None and dasar < bid - safe:
        ref_ss = dasar
    else:
        swing_l = ind.lowest(1, 13)
        if swing_l is not None and swing_l < bid - safe:
            ref_ss = swing_l
    return ref_bs, ref_ss


def kijun_signal(ind: IndicatorSet):
    """Sinyal entry i=8 di bar 1: +1 BUY, -1 SELL, 0 tanpa sinyal."""
    _, kijun, span_a, span_b = ind.ichimoku(5, 13, 26, 1)
    c1 = ind.val(ind.c, 1)
    if None in (kijun, span_a, span_b, c1):
        return 0
    atap, dasar = max(span_a, span_b), min(span_a, span_b)
    if c1 > kijun and c1 > atap:
        return +1
    if c1 < kijun and c1 < dasar:
        return -1
    return 0


# --------------------------------------------------------------- teknik 9
def cloud_forward(ind: IndicatorSet):
    """Awan masa depan i=9: +1 hijau (bias BUY), -1 merah, 0 tak diketahui."""
    span_a, span_b = ind.ichimoku_forward(9, 26, 52)
    if span_a is None or span_b is None:
        return 0
    if span_a > span_b:
        return +1
    if span_a < span_b:
        return -1
    return 0


def rsi_cross(ind: IndicatorSet, level: float, up: bool) -> bool:
    """RSI menembus ``level`` naik/turun pada transisi bar 2->1."""
    r1, r2 = ind.val(ind.rsi, 1), ind.val(ind.rsi, 2)
    if r1 is None or r2 is None:
        return False
    if up:
        return r2 <= level < r1
    return r2 >= level > r1
