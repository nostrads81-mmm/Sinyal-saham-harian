"""Simulator broker MT5 hedging: posisi, pending BS/SS, close-by, margin.

Model harga: tiap bar M1 dipecah jadi jalur 4 titik O->H->L->C (atau
O->L->H->C bila bar naik). Pending stop ter-trigger saat harga jalur
menyentuh price; fill di harga pending (tanpa slippage). Buy dibuka/ditutup
di Ask/Bid, sell di Bid/Ask. Close-by menutup dua posisi berlawanan tanpa
spread (padanan ORDER_TYPE_CLOSE_BY).
"""

import itertools
from dataclasses import dataclass, field


@dataclass
class SymbolSpec:
    name: str = "XAUUSD"
    point: float = 0.01
    digits: int = 2
    contract: float = 100.0        # nilai 1.0 pergerakan harga per 1 lot
    spread_points: int = 20
    stops_level_points: int = 30
    lot_min: float = 0.01
    lot_step: float = 0.01
    lot_max: float = 100.0
    leverage: float = 100.0

    @property
    def spread(self) -> float:
        return self.spread_points * self.point

    @property
    def stops_level(self) -> float:
        return self.stops_level_points * self.point

    def norm_lot(self, lot: float) -> float:
        steps = int(lot / self.lot_step + 1e-9)
        return min(self.lot_max, max(self.lot_min, round(steps * self.lot_step, 2)))


@dataclass
class Position:
    id: int
    magic: int
    dir: int          # +1 buy, -1 sell
    lot: float
    open_price: float
    open_time: object
    comment: str = ""


@dataclass
class Pending:
    id: int
    magic: int
    ptype: str        # 'BS' buy stop | 'SS' sell stop
    lot: float
    price: float
    comment: str = ""
    parked: bool = False   # padanan "rem 99"


@dataclass
class ClosedTrade:
    magic: int
    dir: int
    lot: float
    open_price: float
    close_price: float
    profit: float
    open_time: object
    close_time: object
    comment: str = ""


class SimBroker:
    def __init__(self, spec: SymbolSpec = None, balance: float = 10_000.0):
        self.spec = spec or SymbolSpec()
        self.balance = balance
        self.bid = 0.0
        self.time = None
        self._ids = itertools.count(1)
        self.positions: dict[int, Position] = {}
        self.pendings: dict[int, Pending] = {}
        self.history: list[ClosedTrade] = []
        self.equity_curve: list[tuple] = []   # (time, equity)

    # ------------------------------------------------------------- harga
    @property
    def ask(self) -> float:
        return self.bid + self.spec.spread

    def set_price(self, bid: float, time=None) -> None:
        """Update harga lalu proses trigger pending (non-parked)."""
        self.bid = bid
        if time is not None:
            self.time = time
        for pid in list(self.pendings):
            p = self.pendings.get(pid)
            if p is None or p.parked:
                continue
            if p.ptype == "BS" and self.ask >= p.price:
                del self.pendings[pid]
                self._open(p.magic, +1, p.lot, p.price, p.comment)
            elif p.ptype == "SS" and self.bid <= p.price:
                del self.pendings[pid]
                self._open(p.magic, -1, p.lot, p.price, p.comment)

    # ------------------------------------------------------------- order ops
    def market(self, magic: int, direction: int, lot: float, comment: str = "") -> Position:
        price = self.ask if direction > 0 else self.bid
        return self._open(magic, direction, self.spec.norm_lot(lot), price, comment)

    def _open(self, magic, direction, lot, price, comment) -> Position:
        pos = Position(next(self._ids), magic, direction, lot, price, self.time, comment)
        self.positions[pos.id] = pos
        return pos

    def place_pending(self, magic: int, ptype: str, lot: float, price: float,
                      comment: str = "", enforce_stops: bool = True) -> Pending:
        if enforce_stops:
            if ptype == "BS" and price < self.ask + self.spec.stops_level:
                raise ValueError("BS terlalu dekat harga (stops level)")
            if ptype == "SS" and price > self.bid - self.spec.stops_level:
                raise ValueError("SS terlalu dekat harga (stops level)")
        p = Pending(next(self._ids), magic, ptype, self.spec.norm_lot(lot),
                    price, comment)
        self.pendings[p.id] = p
        return p

    def modify_pending(self, pid: int, price: float) -> bool:
        p = self.pendings.get(pid)
        if p is None:
            return False
        if p.ptype == "BS" and price < self.ask + self.spec.stops_level:
            return False
        if p.ptype == "SS" and price > self.bid - self.spec.stops_level:
            return False
        p.price = price
        return True

    def delete_pending(self, pid: int) -> None:
        self.pendings.pop(pid, None)

    def close_position(self, pid: int) -> float:
        pos = self.positions.pop(pid, None)
        if pos is None:
            return 0.0
        price = self.bid if pos.dir > 0 else self.ask
        profit = self._profit_at(pos, price)
        self.balance += profit
        self.history.append(ClosedTrade(pos.magic, pos.dir, pos.lot,
                                        pos.open_price, price, profit,
                                        pos.open_time, self.time, pos.comment))
        return profit

    def close_by(self, id_buy: int, id_sell: int) -> float:
        """Tutup pasangan buy+sell saling menutup (tanpa spread).

        Lot beda: bagian overlap ditutup, sisa lot tetap terbuka.
        """
        b = self.positions.get(id_buy)
        s = self.positions.get(id_sell)
        if b is None or s is None or b.dir != 1 or s.dir != -1:
            return 0.0
        lot = min(b.lot, s.lot)
        profit = (s.open_price - b.open_price) * self.spec.contract * lot
        self.balance += profit
        self.history.append(ClosedTrade(b.magic, 0, lot, b.open_price,
                                        s.open_price, profit, b.open_time,
                                        self.time, "closeby"))
        for pos in (b, s):
            pos.lot = round(pos.lot - lot, 2)
            if pos.lot < self.spec.lot_min - 1e-9:
                self.positions.pop(pos.id, None)
        return profit

    def close_all_magic(self, magic: int) -> float:
        """TutupMagic: close-by per pasangan dulu, sisanya close biasa."""
        total = 0.0
        while True:
            buys = sorted((p for p in self.positions.values()
                           if p.magic == magic and p.dir > 0),
                          key=lambda p: -p.lot)
            sells = sorted((p for p in self.positions.values()
                            if p.magic == magic and p.dir < 0),
                           key=lambda p: -p.lot)
            if not buys or not sells:
                break
            total += self.close_by(buys[0].id, sells[0].id)
        for p in [p for p in self.positions.values() if p.magic == magic]:
            total += self.close_position(p.id)
        for pid in [pid for pid, p in self.pendings.items() if p.magic == magic]:
            del self.pendings[pid]
        return total

    # ------------------------------------------------------------- kueri
    def positions_of(self, magic: int):
        return [p for p in self.positions.values() if p.magic == magic]

    def pendings_of(self, magic: int, ptype: str = None):
        return [p for p in self.pendings.values()
                if p.magic == magic and (ptype is None or p.ptype == ptype)]

    def _profit_at(self, pos: Position, price: float) -> float:
        return (price - pos.open_price) * pos.dir * self.spec.contract * pos.lot

    def profit(self, pos: Position) -> float:
        price = self.bid if pos.dir > 0 else self.ask
        return self._profit_at(pos, price)

    def floating(self, magic: int = None) -> float:
        return sum(self.profit(p) for p in self.positions.values()
                   if magic is None or p.magic == magic)

    @property
    def equity(self) -> float:
        return self.balance + self.floating()

    def margin(self) -> float:
        return sum(p.lot * self.spec.contract * self.bid / self.spec.leverage
                   for p in self.positions.values())

    def margin_level(self) -> float:
        m = self.margin()
        return float("inf") if m <= 0 else self.equity / m * 100.0

    def record_equity(self) -> None:
        self.equity_curve.append((self.time, self.equity))
