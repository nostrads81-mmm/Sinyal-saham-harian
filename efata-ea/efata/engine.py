"""Mesin inti EfataTech EA (per magic, 1x/detik).

Urutan per magic mengikuti dokumen bagian 10:
  PINDAI -> REPLIKASI -> LAWAN -> TEMAN -> UPDATE -> PENGAMAN -> EXIT

Mode lot (dokumen bagian 6):
  xLot > 1  : martingale, lot lawan = induk * xLot (tangga eksponensial)
  xLot = 1  : ModePasangan (aktif bila |xLot-1|<0.001, xLotLinier=0, Z<=E):
              BS+SS sepasang per level dengan lot awal
  xLotLinier> 0: lot Lx = init * (x+1) * xLotLinier
Teknik i=4 selalu lot-sama (lawan lot = induk) apa pun xLot.
"""

import math
from dataclasses import dataclass, field
from datetime import timedelta

from .broker import SimBroker
from .indicators import IndicatorSet
from .data import TFAggregator
from .magic import MagicId, decode_magic, parse_command, auto_lot, TF_MAP
from .params import Params
from . import techniques as tech

STANDBY_BS = 7_777_777.0
STANDBY_SS = 0.07


@dataclass
class MagicConfig:
    mid: MagicId
    init_lot: float


@dataclass
class MagicState:
    worst_floating: float = 0.0
    teman_total: int = 0
    teman_by_level: dict = field(default_factory=dict)   # (level, dir) -> n
    last_fract_time: dict = field(default_factory=dict)  # dir -> time fraktal terakhir dipakai
    last_close_time: object = None
    rounds_done: int = 0
    cut_count: int = 0
    # i=9
    day: object = None
    day_start_balance: float = 0.0
    locked_today: bool = False
    target_pulih: float = 0.0
    last_entry_bar: object = None
    last_marti_bar: object = None

    def reset_cycle(self):
        self.worst_floating = 0.0
        self.teman_total = 0
        self.teman_by_level.clear()
        self.target_pulih = 0.0


@dataclass
class TechCtx:
    ind_e: IndicatorSet
    ind_z: IndicatorSet
    ind_x: IndicatorSet
    bid: float
    ask: float
    spec: object
    params: Params
    level: int


class Engine:
    def __init__(self, broker: SimBroker, params: Params = None,
                 technique_map: dict = None):
        self.broker = broker
        self.params = params or Params()
        self.magics: dict[int, MagicConfig] = {}
        self.states: dict[int, MagicState] = {}
        self.loops: dict[int, float] = {}          # magic -> lot (LS Loop)
        self._loop_restarts: dict = {}             # (magic, date) -> n
        self.ind: dict[str, IndicatorSet] = {}
        self.agg: dict[str, TFAggregator] = {}
        self._margin_parked: set[int] = set()
        # pemetaan digit i -> fungsi target; bisa ditukar bila EA asli beda
        self.target_funcs = dict(tech.TARGET_FUNCS)
        if technique_map:
            self.target_funcs.update(technique_map)
        self.log: list[str] = []

    # ------------------------------------------------------------ data feed
    def _ensure_tf(self, tf: str) -> None:
        if tf not in self.ind:
            self.ind[tf] = IndicatorSet()
            if tf != "M1":
                self.agg[tf] = TFAggregator(tf)

    def on_bar_m1(self, bar) -> None:
        """Masukkan bar M1 SELESAI (dipanggil backtester sebelum step)."""
        self._ensure_tf("M1")
        self.ind["M1"].add_bar(bar)
        for tf, agg in self.agg.items():
            closed = agg.feed(bar)
            if closed is not None:
                self.ind[tf].add_bar(closed)

    # ------------------------------------------------------------ perintah
    def spawn(self, magic: int, lot: float = 0.0) -> None:
        """Padanan perintah spawn LS Kendali (3/5/7 digit)."""
        mid = decode_magic(magic)
        if lot <= 0:
            lot = auto_lot(self.broker.balance, self.params.MM,
                           self.broker.spec.lot_step, self.broker.spec.lot_min)
        for tf in (mid.tf_entry, mid.tf_filter, mid.tf_lawan):
            self._ensure_tf(tf)
        self.magics[magic] = MagicConfig(mid, self.broker.spec.norm_lot(lot))
        self.states.setdefault(magic, MagicState())

    def execute(self, tp: float) -> None:
        """Padanan mengisi kolom TP LS Kendali (dokumen bagian 2)."""
        cmd = parse_command(tp)
        b = self.broker
        if cmd.kind == "control":
            if cmd.action == "reset":
                self.params.reset_defaults()
            elif cmd.action == "close_all":     # 97: posisi saja
                for pid in list(b.positions):
                    b.close_position(pid)
            elif cmd.action == "del_all":       # 98: posisi + pending
                for pid in list(b.positions):
                    b.close_position(pid)
                b.pendings.clear()
            # 94/95/96/99 & show_slot: manajemen order LS Param di MT5;
            # di Python parameter sudah langsung terlihat -> no-op
            return
        if cmd.kind == "spawn":
            self.spawn(cmd.magic.value, cmd.lot)
            return
        # kind == 'order' (8 digit)
        lot = cmd.lot or auto_lot(b.balance, self.params.MM,
                                  b.spec.lot_step, b.spec.lot_min)
        m = cmd.magic.value
        if cmd.cmd == 1:
            self.spawn(m, lot)
            b.place_pending(m, "BS", lot, STANDBY_BS, enforce_stops=False)
        elif cmd.cmd == 2:
            self.spawn(m, lot)
            b.place_pending(m, "SS", lot, STANDBY_SS, enforce_stops=False)
        elif cmd.cmd == 3:
            self.spawn(m, lot)
            b.market(m, +1, lot)
        elif cmd.cmd == 4:
            self.spawn(m, lot)
            b.market(m, -1, lot)
        elif cmd.cmd == 8:
            self.loops[m] = lot
            self.spawn(m, lot)

    # ------------------------------------------------------------ util
    def _hours_ok(self) -> bool:
        p = self.params
        if p.endTrade >= 24 and p.startTrade <= 0:
            return True
        t = self.broker.time
        if t is None:
            return True
        wib = (t.hour + int(p.wibOffset)) % 24
        s, e = int(p.startTrade), int(p.endTrade)
        if e >= 24:
            return wib >= s
        if s <= e:
            return s <= wib < e
        return wib >= s or wib < e

    def _mode_pasangan(self, cfg: MagicConfig) -> bool:
        p = self.params
        return (abs(p.xLot - 1.0) < 0.001 and p.xLotLinier == 0
                and cfg.mid.Z <= cfg.mid.E)

    def _equal_lot(self, cfg: MagicConfig) -> bool:
        return cfg.mid.i == 4 or self._mode_pasangan(cfg)

    def ladder_lot(self, cfg: MagicConfig, level: int) -> float:
        p = self.params
        init = cfg.init_lot
        if p.xLotLinier > 0:
            base = init * (level + 1) * p.xLotLinier
        elif p.xLot > 1:
            base = init * (p.xLot ** level)
        else:
            base = init
        return self.broker.spec.norm_lot(base * p.booster_multiplier(level))

    def level_from_lot(self, cfg: MagicConfig, lot: float) -> int:
        p = self.params
        init = cfg.init_lot
        if lot <= 0 or init <= 0:
            return 0
        if p.xLotLinier > 0:
            return max(0, round(lot / (init * p.xLotLinier)) - 1)
        if p.xLot > 1:
            return max(0, round(math.log(lot / init) / math.log(p.xLot)))
        return 0

    def _magic_level(self, cfg: MagicConfig, buys, sells) -> int:
        if self._equal_lot(cfg):
            return min(len(buys), len(sells)) + (
                0 if len(buys) == len(sells) else 0)
        maxlot = max([p.lot for p in buys + sells] or [0.0])
        return self.level_from_lot(cfg, maxlot)

    def _ema_close(self, ind: IndicatorSet, period: int):
        n = min(len(ind.c), max(int(period) * 4, int(period) + 1))
        if n < period:
            return None
        k = 2.0 / (period + 1.0)
        ema = ind.c[-n]
        for x in ind.c[-n + 1:]:
            ema += k * (x - ema)
        return ema

    def _tutup_magic(self, magic: int) -> None:
        self.broker.close_all_magic(magic)
        st = self.states[magic]
        st.reset_cycle()
        st.last_close_time = self.broker.time

    # ------------------------------------------------------------ step utama
    def step(self) -> None:
        """Satu siklus 'OnTick throttle 1 detik'."""
        b = self.broker
        p = self.params

        # exit global (dokumen slot 2, 10, 11)
        fl_all = b.floating()
        if (p.exitUSD > 0 and fl_all > p.exitUSD) or \
           (p.exitBid > 0 and b.bid > p.exitBid) or \
           (p.exitBidMin > 0 and b.bid < p.exitBidMin):
            for m in list(self.magics):
                self._tutup_magic(m)
            return

        # LS Loop: respawn magic yang sudah kosong
        for m, lot in list(self.loops.items()):
            if m in self.magics and not b.positions_of(m) and not b.pendings_of(m):
                day = b.time.date() if b.time else None
                key = (m, day)
                n = self._loop_restarts.get(key, 0)
                if p.loopPerDay > 0 and n >= p.loopPerDay:
                    continue
                self._loop_restarts[key] = n + 1

        for magic in list(self.magics):
            self._step_magic(magic)

        # pengaman margin: parkir/lepas semua BS/SS (padanan rem 99).
        # Deviasi kecil dari EA asli: rem dilepas otomatis saat margin pulih
        # (di MT5 dilepas manual) supaya backtest bisa lanjut. Rem yang
        # dipasang maxLevel tidak ikut dilepas.
        if p.minMarginLev > 0:
            if b.margin_level() < p.minMarginLev:
                for pd in b.pendings.values():
                    if not pd.parked:
                        pd.parked = True
                        self._margin_parked.add(pd.id)
            else:
                for pid in list(self._margin_parked):
                    pd = b.pendings.get(pid)
                    if pd is not None:
                        pd.parked = False
                    self._margin_parked.discard(pid)

    # ------------------------------------------------------------ per magic
    def _step_magic(self, magic: int) -> None:
        cfg = self.magics[magic]
        st = self.states[magic]
        i = cfg.mid.i
        if i == 3:
            self._step_turtle(magic, cfg, st)
        elif i == 8:
            self._step_kijun(magic, cfg, st)
        elif i == 9:
            self._step_ichi(magic, cfg, st)
        else:
            self._step_standard(magic, cfg, st)

    # ---------------------------------------------------- teknik pending 1-7
    def _snapshot(self, magic: int):
        b = self.broker
        pos = b.positions_of(magic)
        buys = [q for q in pos if q.dir > 0]
        sells = [q for q in pos if q.dir < 0]
        bs = b.pendings_of(magic, "BS")
        ss = b.pendings_of(magic, "SS")
        return pos, buys, sells, bs, ss

    def _seed_pair(self, magic: int, lot: float) -> None:
        b = self.broker
        b.place_pending(magic, "BS", lot, STANDBY_BS, enforce_stops=False)
        b.place_pending(magic, "SS", lot, STANDBY_SS, enforce_stops=False)

    def _ctx(self, cfg: MagicConfig, level: int) -> TechCtx:
        return TechCtx(
            ind_e=self.ind[cfg.mid.tf_entry],
            ind_z=self.ind[cfg.mid.tf_filter],
            ind_x=self.ind[cfg.mid.tf_lawan],
            bid=self.broker.bid, ask=self.broker.ask,
            spec=self.broker.spec, params=self.params, level=level)

    def _step_standard(self, magic: int, cfg: MagicConfig, st: MagicState) -> None:
        b = self.broker
        p = self.params
        spec = b.spec
        pos, buys, sells, bs_pend, ss_pend = self._snapshot(magic)
        equal = self._equal_lot(cfg)
        hours = self._hours_ok()
        level = self._magic_level(cfg, buys, sells)

        # PINDAI/seed (padanan MQL_TESTER: pasangan siaga otomatis saat kosong)
        if not pos and not bs_pend and not ss_pend and hours:
            self._seed_pair(magic, cfg.init_lot)
            pos, buys, sells, bs_pend, ss_pend = self._snapshot(magic)

        maxbuy = max([q.lot for q in buys] or [0.0])
        maxsell = max([q.lot for q in sells] or [0.0])

        # LAWAN (di luar jam trading tanpa posisi: jangan buat order baru)
        if equal:
            if buys or sells or hours:
                self._lawan_pasangan(magic, cfg, st, level, buys, sells,
                                     bs_pend, ss_pend)
        else:
            self._lawan_marti(magic, cfg, level, maxbuy, maxsell,
                              bs_pend, ss_pend)
        pos, buys, sells, bs_pend, ss_pend = self._snapshot(magic)

        # TEMAN -T
        if hours:
            self._teman(magic, cfg, st, level, maxbuy, maxsell)

        # UPDATE target sesuai teknik
        ctx = self._ctx(cfg, level)
        plan = self.target_funcs[cfg.mid.i](ctx)
        if plan.cut:                                   # i=7 potong sideways
            self._tutup_magic(magic)
            return
        if plan.convert_bs:                            # i=5 cross -> market
            for q in list(bs_pend):
                b.delete_pending(q.id)
                b.market(magic, +1, q.lot, q.comment)
        if plan.convert_ss:
            for q in list(ss_pend):
                b.delete_pending(q.id)
                b.market(magic, -1, q.lot, q.comment)
        if not plan.convert_bs and not plan.convert_ss:
            self._apply_targets(magic, cfg, plan, level, buys, sells,
                                maxbuy, maxsell, hours)

        # PENGAMAN level
        if p.maxLevCut > 0:
            if equal:
                locked = (buys and len(buys) == len(sells)
                          and abs(sum(q.lot for q in buys)
                                  - sum(q.lot for q in sells)) < 1e-9)
                if locked and len(buys) >= p.maxLevCut:
                    st.cut_count += 1
                    self._tutup_magic(magic)
                    return
            elif level >= p.maxLevCut and pos:
                st.cut_count += 1
                self._tutup_magic(magic)
                return
        if p.maxLevel > 0 and level >= p.maxLevel and not equal:
            for q in self.broker.pendings_of(magic):
                q.parked = True                        # rem 99

        # nextRound X.Y: spawn magic m+1 di level X, total Y ronde
        if p.nextRound > 0:
            lx, frac = Params.split_xy(p.nextRound)
            rounds = int(round(frac * 10))
            if lx > 0 and level >= lx and st.rounds_done < rounds:
                new_mid = MagicId(cfg.mid.i, min(9, cfg.mid.m + 1),
                                  cfg.mid.Z, cfg.mid.E, cfg.mid.X)
                if new_mid.value not in self.magics:
                    self.spawn(new_mid.value, cfg.init_lot)
                    st.rounds_done += 1

        # EXIT
        self._exits(magic, cfg, st, level)

    # ------------------------------------------------------------ LAWAN
    def _lawan_marti(self, magic, cfg, level, maxbuy, maxsell,
                     bs_pend, ss_pend) -> None:
        """Sisi dominan dilawan pending seberang lot = induk * xLot."""
        b = self.broker
        bs_pend = [q for q in bs_pend if q.comment != "-TL"]
        ss_pend = [q for q in ss_pend if q.comment != "-TL"]
        if maxbuy > maxsell:
            lawan = self.ladder_lot(cfg, level + 1) if self.params.xLot > 1 \
                else b.spec.norm_lot(maxbuy * max(self.params.xLot, 1.0))
            for q in bs_pend:
                b.delete_pending(q.id)
            for q in ss_pend:
                if q.lot < lawan - 1e-9:
                    b.delete_pending(q.id)
            if not b.pendings_of(magic, "SS"):
                b.place_pending(magic, "SS", lawan, STANDBY_SS,
                                enforce_stops=False)
        elif maxsell > maxbuy:
            lawan = self.ladder_lot(cfg, level + 1) if self.params.xLot > 1 \
                else b.spec.norm_lot(maxsell * max(self.params.xLot, 1.0))
            for q in ss_pend:
                b.delete_pending(q.id)
            for q in bs_pend:
                if q.lot < lawan - 1e-9:
                    b.delete_pending(q.id)
            if not [q for q in b.pendings_of(magic, "BS")
                    if q.comment != "-TL"]:
                b.place_pending(magic, "BS", lawan, STANDBY_BS,
                                enforce_stops=False)
        # terkunci 1:1 -> DIAM (anti loop hapus-buat)

    def _lawan_pasangan(self, magic, cfg, st, level, buys, sells,
                        bs_pend, ss_pend) -> None:
        """xLot=1 / i=4: pending BS & SS selalu ada dengan lot pasangan."""
        b = self.broker
        p = self.params
        if p.maxLevel > 0 and level >= p.maxLevel:
            return                                    # ladder berhenti di Lx
        if cfg.mid.i == 4:
            want = max([q.lot for q in buys + sells] or [cfg.init_lot])
        else:
            want = cfg.init_lot                       # pasangan: lot awal
        want = b.spec.norm_lot(want)
        for side, pend, standby in (("BS", bs_pend, STANDBY_BS),
                                    ("SS", ss_pend, STANDBY_SS)):
            pend = [q for q in pend if q.comment != "-TL"]
            keep = None
            for q in pend:
                if keep is None and abs(q.lot - want) < 1e-9:
                    keep = q
                else:
                    b.delete_pending(q.id)
            if keep is None:
                b.place_pending(magic, side, want, standby,
                                enforce_stops=False)

    # ------------------------------------------------------------ TEMAN -T
    def _teman(self, magic, cfg, st, level, maxbuy, maxsell) -> None:
        p = self.params
        if p.addTemen <= 0:
            return
        b = self.broker
        ind = self.ind[cfg.mid.tf_entry]
        macd1 = ind.val(ind.macd, 1)
        if macd1 is None:
            return
        pasangan = self._equal_lot(cfg)
        dominant = +1 if maxbuy > maxsell else (-1 if maxsell > maxbuy else 0)

        for direction, fract_up in ((+1, False), (-1, True)):
            # buy teman lahir di lembah baru saat MACD atas; sell mirror
            if direction > 0 and macd1 <= 0:
                continue
            if direction < 0 and macd1 >= 0:
                continue
            if not pasangan and dominant != direction:
                continue
            if not b.positions_of(magic):
                continue
            k = ind.last_fractal(up=fract_up)
            if k is None:
                continue
            f_time = ind.val(ind.time, k)
            key = direction
            if st.last_fract_time.get(key) is None:
                st.last_fract_time[key] = f_time      # jangan tembak saat init
                continue
            if f_time == st.last_fract_time[key]:
                continue
            # batas jumlah teman
            if pasangan:
                cnt_key = (level, direction)
                n = st.teman_by_level.get(cnt_key, 0)
                if n >= p.addTemen:
                    continue
                st.teman_by_level[cnt_key] = n + 1
                n_total = n + 1
            else:
                if st.teman_total >= p.addTemen:
                    continue
                st.teman_total += 1
                n_total = st.teman_total
            st.last_fract_time[key] = f_time
            lot = cfg.init_lot * (p.lotTeman ** n_total) if p.lotTeman > 0 \
                else cfg.init_lot
            lot = b.spec.norm_lot(lot)
            b.market(magic, direction, lot, comment="-T")
            # pelindung -TL 1:1 di seberang (ikut digeser rutin update)
            side = "SS" if direction > 0 else "BS"
            standby = STANDBY_SS if direction > 0 else STANDBY_BS
            b.place_pending(magic, side, lot, standby, comment="-TL",
                            enforce_stops=False)

    # ------------------------------------------------------------ UPDATE
    def _apply_targets(self, magic, cfg, plan, level, buys, sells,
                       maxbuy, maxsell, hours) -> None:
        b = self.broker
        p = self.params
        spec = b.spec
        ind_e = self.ind[cfg.mid.tf_entry]
        equal = self._equal_lot(cfg)
        if not hours:
            return
        movable_bs = equal or (not buys) or (maxsell > maxbuy)
        movable_ss = equal or (not sells) or (maxbuy > maxsell)

        ema = None
        if p.useEMA > 0:
            ema = self._ema_close(ind_e, int(p.useEMA))
        rsi_gate_bs = rsi_gate_ss = True
        if p.useRSI > 0 and not buys and not sells:
            tf = TF_MAP.get(int(p.useRSI))
            if tf:
                self._ensure_tf(tf)
                r = self.ind[tf].val(self.ind[tf].rsi, 1)
                if r is not None:
                    rsi_gate_bs = r < 70.0
                    rsi_gate_ss = r > 30.0

        for q in b.pendings_of(magic, "BS"):
            if q.parked or plan.bs is None or not movable_bs:
                continue
            if not rsi_gate_bs:
                continue
            price = round(plan.bs, spec.digits)
            if ema is not None and price <= ema:
                continue
            if plan.bs_away_only and q.price < STANDBY_BS and price < q.price:
                continue
            if p.TR == 0 and q.price < STANDBY_BS:
                continue                               # isi 1x saat open
            if abs(price - q.price) > spec.point / 2:
                b.modify_pending(q.id, price)

        for q in b.pendings_of(magic, "SS"):
            if q.parked or plan.ss is None or not movable_ss:
                continue
            if not rsi_gate_ss:
                continue
            price = round(plan.ss, spec.digits)
            if ema is not None and price >= ema:
                continue
            if plan.ss_away_only and q.price > STANDBY_SS and price > q.price:
                continue
            if p.TR == 0 and q.price > STANDBY_SS:
                continue
            if abs(price - q.price) > spec.point / 2:
                b.modify_pending(q.id, price)

    # ------------------------------------------------------------ EXIT
    def _exits(self, magic, cfg, st, level) -> None:
        b = self.broker
        p = self.params
        fl = b.floating(magic)
        if not b.positions_of(magic):
            st.worst_floating = 0.0
            return
        st.worst_floating = min(st.worst_floating, fl)

        if p.exitPct > 0 and fl > p.exitPct / 100.0 * b.balance:
            self._tutup_magic(magic)
            return
        if p.lossMaxUSD > 0 and fl < -p.lossMaxUSD:
            self._tutup_magic(magic)
            return
        if p.lossMaxPersen > 0 and fl < -p.lossMaxPersen / 100.0 * b.balance:
            self._tutup_magic(magic)
            return
        if p.exitRR > 0 and st.worst_floating < 0:
            rr, frac = Params.split_xy(p.exitRR)
            start_level = int(round(frac * 10))
            if rr > 0 and level >= start_level and \
                    fl > rr * abs(st.worst_floating):
                self._tutup_magic(magic)

    # ------------------------------------------------------------ i=3 Turtle
    def _step_turtle(self, magic, cfg, st) -> None:
        b = self.broker
        spec = b.spec
        ind = self.ind[cfg.mid.tf_entry]
        pos = b.positions_of(magic)
        atr = ind.val(ind.atr, 1)
        if atr and atr > 0:
            unit = 0.01 * b.balance / (atr * spec.contract)
            unit = spec.norm_lot(unit)
        else:
            unit = spec.lot_min

        if not pos:
            if not self._hours_ok():
                return
            bs = b.pendings_of(magic, "BS")
            ss = b.pendings_of(magic, "SS")
            if not bs and not ss:
                self._seed_pair(magic, unit)
                bs = b.pendings_of(magic, "BS")
                ss = b.pendings_of(magic, "SS")
            hh, ll = ind.highest(1, 20), ind.lowest(1, 20)
            if hh is None or ll is None:
                return
            for q in bs:
                if abs(q.lot - unit) > 1e-9:
                    b.delete_pending(q.id)
                    b.place_pending(magic, "BS", unit, STANDBY_BS,
                                    enforce_stops=False)
                    continue
                b.modify_pending(q.id, round(hh, spec.digits))
            for q in ss:
                if abs(q.lot - unit) > 1e-9:
                    b.delete_pending(q.id)
                    b.place_pending(magic, "SS", unit, STANDBY_SS,
                                    enforce_stops=False)
                    continue
                b.modify_pending(q.id, round(ll, spec.digits))
            return

        # ada posisi: tanpa martingale/pyramid -> hapus semua pending
        for q in b.pendings_of(magic):
            b.delete_pending(q.id)
        longs = [q for q in pos if q.dir > 0]
        shorts = [q for q in pos if q.dir < 0]
        lo10, hi10 = ind.lowest(1, 10), ind.highest(1, 10)
        if longs and lo10 is not None and b.bid < lo10:
            self._tutup_magic(magic)
            return
        if shorts and hi10 is not None and b.ask > hi10:
            self._tutup_magic(magic)
            return
        self._exits(magic, cfg, st, 0)

    # ------------------------------------------------------------ i=8 Kijun
    def _step_kijun(self, magic, cfg, st) -> None:
        b = self.broker
        p = self.params
        spec = b.spec
        ind = self.ind[cfg.mid.tf_entry]
        pos, buys, sells, bs_pend, ss_pend = self._snapshot(magic)
        maxbuy = max([q.lot for q in buys] or [0.0])
        maxsell = max([q.lot for q in sells] or [0.0])
        level = self.level_from_lot(cfg, max(maxbuy, maxsell))

        # ENTRY L0 market saat magic kosong (jeda 30 detik setelah tutup)
        if not pos and not bs_pend and not ss_pend:
            if not self._hours_ok():
                return
            if st.last_close_time is not None and b.time is not None and \
                    (b.time - st.last_close_time) < timedelta(seconds=30):
                return
            sig = tech.kijun_signal(ind)
            if sig != 0:
                b.market(magic, sig, cfg.init_lot)
            return

        # LAWAN martingale + geser ke acuan Kijun/Kumo/swing
        self._lawan_marti(magic, cfg, level, maxbuy, maxsell,
                          bs_pend, ss_pend)
        ref_bs, ref_ss = tech.kijun_reference(ind, b.bid, spec.point)
        if ref_bs is None:
            self._exits(magic, cfg, st, level)
            return
        tgt_bs = ref_bs + 70 * spec.point
        tgt_ss = ref_ss - 70 * spec.point
        # anti numpuk: minimal 50 point dari open posisi mana pun
        for q in pos:
            if abs(tgt_bs - q.open_price) < 50 * spec.point:
                tgt_bs = q.open_price + 50 * spec.point
            if abs(tgt_ss - q.open_price) < 50 * spec.point:
                tgt_ss = q.open_price - 50 * spec.point
        movable_bs = (not buys) or (maxsell > maxbuy)
        movable_ss = (not sells) or (maxbuy > maxsell)
        for q in b.pendings_of(magic, "BS"):
            if movable_bs and not q.parked:
                b.modify_pending(q.id, round(tgt_bs, spec.digits))
        for q in b.pendings_of(magic, "SS"):
            if movable_ss and not q.parked:
                b.modify_pending(q.id, round(tgt_ss, spec.digits))
        self._exits(magic, cfg, st, level)

    # ------------------------------------------------------------ i=9 Ichi
    def _step_ichi(self, magic, cfg, st) -> None:
        b = self.broker
        spec = b.spec
        ind = self.ind[cfg.mid.tf_entry]
        pos = b.positions_of(magic)
        today = b.time.date() if b.time else None

        if st.day != today:
            st.day = today
            st.day_start_balance = b.balance
            st.locked_today = False

        # KUNCI HARIAN +-5% dari balance awal hari
        profit_today = (b.balance - st.day_start_balance) + b.floating(magic)
        limit = 0.05 * st.day_start_balance
        if st.locked_today:
            return
        if st.day_start_balance > 0 and abs(profit_today) >= limit:
            self._tutup_magic(magic)
            st.locked_today = True
            return

        cloud = tech.cloud_forward(ind)
        bar1_time = ind.val(ind.time, 1)

        if not pos:
            if not self._hours_ok() or cloud == 0 or bar1_time is None:
                return
            if st.last_entry_bar == bar1_time:
                return                                # maks 1 entry per bar
            if cloud > 0 and tech.rsi_cross(ind, 70.0, up=True):
                b.market(magic, +1, cfg.init_lot)
                st.last_entry_bar = bar1_time
            elif cloud < 0 and tech.rsi_cross(ind, 30.0, up=False):
                b.market(magic, -1, cfg.init_lot)
                st.last_entry_bar = bar1_time
            return

        fl = b.floating(magic)
        newest = max(pos, key=lambda q: q.id)
        reversal = (newest.dir > 0 and cloud < 0) or \
                   (newest.dir < 0 and cloud > 0)

        # EXIT (a) recovery tercapai
        if st.target_pulih > 0 and fl >= st.target_pulih:
            self._tutup_magic(magic)
            return
        # EXIT (b) belum recovery & ada posisi untung >= 200 point
        if st.target_pulih == 0:
            for q in pos:
                price = b.bid if q.dir > 0 else b.ask
                if (price - q.open_price) * q.dir >= 200 * spec.point:
                    self._tutup_magic(magic)
                    return
        # EXIT (c) sinyal balik arah & floating positif
        if reversal and fl > 0:
            self._tutup_magic(magic)
            return

        # MARTINGALE BALIK-ARAH (x3, max 4 step -> posisi max 5)
        if reversal and fl < 0:
            n = len(pos)
            if n > 4:
                st.target_pulih = abs(fl) * 2.0       # step mentok
                return
            if st.last_marti_bar == bar1_time:
                return                                # maks 1 marti per bar
            new_dir = -newest.dir
            price_now = b.bid if new_dir < 0 else b.ask
            # Guard1: mulai marti ke-2, harga wajib bergerak >=300 point
            if n >= 2:
                moved = (newest.open_price - price_now) * newest.dir
                if moved < 300 * spec.point:
                    return
            # Guard2: mulai posisi searah ke-3, entry >=300 point melampaui
            same = [q for q in pos if q.dir == new_dir]
            if len(same) >= 2:
                last_same = max(same, key=lambda q: q.id)
                beyond = (price_now - last_same.open_price) * new_dir
                if beyond < 300 * spec.point:
                    return
            lot = spec.norm_lot(cfg.init_lot * (3 ** n))
            b.market(magic, new_dir, lot)
            st.last_marti_bar = bar1_time
            st.target_pulih = abs(fl) * 2.0
