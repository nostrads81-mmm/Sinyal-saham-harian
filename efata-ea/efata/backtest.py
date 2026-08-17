"""Backtester bar M1: jalur intrabar O->H->L->C, engine 1x per titik jalur.

Aproksimasi vs MT5 Strategy Tester (didokumentasikan di README):
engine dipanggil 4x per bar M1 (~tiap 15 detik) bukan tiap tick; pending
ter-fill tepat di harganya tanpa slippage; spread konstan.
"""

from dataclasses import dataclass, field

from .broker import SimBroker, SymbolSpec
from .engine import Engine
from .params import Params


@dataclass
class Stats:
    bars: int = 0
    start_balance: float = 0.0
    final_balance: float = 0.0
    final_equity: float = 0.0
    max_drawdown: float = 0.0       # dari equity, dalam uang
    max_drawdown_pct: float = 0.0
    trades: int = 0
    wins: int = 0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    open_positions: int = 0

    @property
    def profit_factor(self) -> float:
        return self.gross_profit / abs(self.gross_loss) if self.gross_loss else float("inf")

    def report(self) -> str:
        wr = 100.0 * self.wins / self.trades if self.trades else 0.0
        pf = self.profit_factor
        pf_s = f"{pf:.2f}" if pf != float("inf") else "inf"
        return (
            f"bars           : {self.bars}\n"
            f"balance        : {self.start_balance:.2f} -> {self.final_balance:.2f}\n"
            f"equity akhir   : {self.final_equity:.2f}\n"
            f"max drawdown   : {self.max_drawdown:.2f} ({self.max_drawdown_pct:.1f}%)\n"
            f"trades (closed): {self.trades}  win {self.wins} ({wr:.1f}%)\n"
            f"gross P/L      : +{self.gross_profit:.2f} / {self.gross_loss:.2f}"
            f"  PF {pf_s}\n"
            f"posisi tersisa : {self.open_positions}"
        )


def _bar_path(bar):
    """Jalur intrabar: bar turun O->H->L->C, bar naik O->L->H->C."""
    if bar.c >= bar.o:
        return (bar.o, bar.l, bar.h, bar.c)
    return (bar.o, bar.h, bar.l, bar.c)


class Backtester:
    def __init__(self, spec: SymbolSpec = None, balance: float = 10_000.0,
                 params: Params = None):
        self.broker = SimBroker(spec or SymbolSpec(), balance)
        self.engine = Engine(self.broker, params or Params())

    def run(self, bars, warmup: int = 60) -> Stats:
        b = self.broker
        stats = Stats(start_balance=b.balance)
        peak = b.balance
        for n, bar in enumerate(bars):
            if n < warmup:
                self.engine.on_bar_m1(bar)
                b.set_price(bar.c, bar.time)
                continue
            # engine melihat bar-1 = bar sebelumnya yang sudah selesai
            for px in _bar_path(bar):
                b.set_price(px, bar.time)
                self.engine.step()
            self.engine.on_bar_m1(bar)
            b.record_equity()
            eq = b.equity
            peak = max(peak, eq)
            dd = peak - eq
            if dd > stats.max_drawdown:
                stats.max_drawdown = dd
                stats.max_drawdown_pct = 100.0 * dd / peak if peak else 0.0
            stats.bars += 1
        stats.final_balance = b.balance
        stats.final_equity = b.equity
        closed = [t for t in b.history]
        stats.trades = len(closed)
        stats.wins = sum(1 for t in closed if t.profit > 0)
        stats.gross_profit = sum(t.profit for t in closed if t.profit > 0)
        stats.gross_loss = sum(t.profit for t in closed if t.profit < 0)
        stats.open_positions = len(b.positions)
        return stats
