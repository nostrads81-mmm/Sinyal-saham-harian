const {
  locateWatchlistTable,
  parseWatchlistRows,
  parseWatchlistRowsRaw,
  buildWaSignal,
  computeTpMid,
  mergeSignalSources,
  rankSignals,
  partitionByDate,
  positionSize,
  parseWaMessageText,
} = require('./scoring');

// Builds a fake watchlist grid matching the real sheet's column order:
// DATE, STOCK, BUY PRICE, LAST PRICE, P&L%, SL, TP1, TP2, TP3, STATUS,
// DETAIL STATUS, MM%, LOW, HIGH, CLOSE, KETERANGAN
function watchlistRow({
  date, stock, buyRange, last = '', sl, tp1, tp2 = '-', tp3 = '-',
  status, detailStatus = '', mm = '10%', keterangan = 'DAY TRADE',
}) {
  return [date, stock, buyRange, last, '', sl, tp1, tp2, tp3, status, detailStatus, mm, '', '', '', keterangan];
}

const HEADER = [
  'DATE', 'STOCK', 'BUY PRICE', 'LAST PRICE', 'P&L%', 'SL', 'TP 1', 'TP 2', 'TP 3',
  'STATUS', 'DETAIL STATUS', 'MM (%MODAL)', 'LOW', 'HIGH', 'CLOSE', 'KETERANGAN',
];

const TODAY = new Date(2026, 7, 3); // 03-08-2026, matches "now" passed into tests

describe('locateWatchlistTable', () => {
  test('finds the header row even with junk rows above it', () => {
    const grid = [
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', 'some banner text', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      HEADER,
      watchlistRow({ date: '03-08-2026', stock: 'ABCD', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN' }),
    ];
    const { columnMap, dataRows } = locateWatchlistTable(grid);
    expect(columnMap.DATE).toBe(0);
    expect(columnMap.STOCK).toBe(1);
    expect(columnMap.KETERANGAN).toBe(15);
    expect(dataRows).toHaveLength(1);
  });

  test('throws a descriptive error when no header row is found', () => {
    expect(() => locateWatchlistTable([['a', 'b'], ['c', 'd']])).toThrow(/Tidak ketemu baris header/);
  });
});

describe('parseWatchlistRows', () => {
  function grid(rows) {
    return [HEADER, ...rows];
  }

  test('only keeps rows matching the requested trade type', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'DAYONE', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'DAY TRADE' }),
      watchlistRow({ date: '03-08-2026', stock: 'SWINGONE', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'SWING TRADE' }),
    ]);
    const parsed = parseWatchlistRows(rows, { tradeType: 'DAY TRADE', now: TODAY });
    expect(parsed.map((p) => p.stock)).toEqual(['DAYONE']);
  });

  test('by default includes both DAY TRADE and SWING TRADE rows, tagged with their type', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'DAYONE', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'DAY TRADE' }),
      watchlistRow({ date: '03-08-2026', stock: 'SWINGONE', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'SWING TRADE' }),
      watchlistRow({ date: '03-08-2026', stock: 'OTHERTYPE', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'SCALPING' }),
    ]);
    const parsed = parseWatchlistRows(rows, { now: TODAY });
    expect(parsed.map((p) => [p.stock, p.tradeType]).sort()).toEqual([
      ['DAYONE', 'DAY TRADE'],
      ['SWINGONE', 'SWING TRADE'],
    ]);
  });

  test('entry is always the midpoint of the buy range, never the last price - same for both trade types', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'INRANGE', buyRange: '100-110', last: '105', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'DAY TRADE' }),
      watchlistRow({ date: '03-08-2026', stock: 'ABOVE', buyRange: '100-110', last: '150', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN', keterangan: 'SWING TRADE' }),
    ]);
    const parsed = parseWatchlistRows(rows, { now: TODAY });
    const inRange = parsed.find((p) => p.stock === 'INRANGE');
    const above = parsed.find((p) => p.stock === 'ABOVE');
    expect(inRange.entry).toBe(105);
    expect(above.entry).toBe(105);
  });

  test('keeps the raw buy range (buyLow/buyHigh) alongside the computed entry', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'RANGED', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN' }),
    ]);
    const [signal] = parseWatchlistRows(rows, { now: TODAY });
    expect(signal.buyLow).toBe(100);
    expect(signal.buyHigh).toBe(110);
    expect(signal.entry).toBe(105);
  });

  test('rounds a fractional midpoint up, not down', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'ODD', buyRange: '151-152', last: '151', sl: '145 (-4%)', tp1: '160 (5%)', status: 'OPEN' }),
    ]);
    const parsed = parseWatchlistRows(rows, { now: TODAY });
    expect(parsed.find((p) => p.stock === 'ODD').entry).toBe(152);
  });

  test('flags waitFor when the last price has not reached the buy range yet', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: 'BELOW', buyRange: '100-110', last: '90', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN' }),
    ]);
    const [signal] = parseWatchlistRows(rows, { now: TODAY });
    expect(signal.waitFor).toBe(100);
  });

  test('drops signals once any TP has been hit', () => {
    const rows = grid([
      watchlistRow({
        date: '01-08-2026', stock: 'ALREADYTP', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)',
        status: 'RUNNING', detailStatus: 'HIT TP 1, HOLD & SET TS DI BUY PRICE',
      }),
      watchlistRow({
        date: '01-08-2026', stock: 'STILLGOING', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)',
        status: 'RUNNING', detailStatus: 'HOLD',
      }),
    ]);
    const parsed = parseWatchlistRows(rows, { now: TODAY });
    expect(parsed.map((p) => p.stock)).toEqual(['STILLGOING']);
  });

  test('computes score as TP1% divided by SL%', () => {
    const rows = grid([
      // entry = 105 (midpoint of range), SL 100 -> 4.76%, TP1 120 -> 14.29% away -> score = 3
      watchlistRow({ date: '03-08-2026', stock: 'SCORED', buyRange: '100-110', sl: '100', tp1: '120', status: 'OPEN' }),
    ]);
    const [signal] = parseWatchlistRows(rows, { now: TODAY });
    expect(signal.score).toBeCloseTo(3, 2);
  });

  test('computes ageDays relative to the given "now"', () => {
    const rows = grid([
      watchlistRow({ date: '01-08-2026', stock: 'OLDER', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN' }),
      watchlistRow({ date: '03-08-2026', stock: 'FRESH', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)', status: 'OPEN' }),
    ]);
    const parsed = parseWatchlistRows(rows, { now: TODAY });
    expect(parsed.find((p) => p.stock === 'OLDER').ageDays).toBe(2);
    expect(parsed.find((p) => p.stock === 'FRESH').ageDays).toBe(0);
  });
});

describe('parseWatchlistRowsRaw', () => {
  function grid(rows) {
    return [HEADER, ...rows];
  }

  test('keeps rows even after a TP has been hit, unlike parseWatchlistRows', () => {
    const rows = grid([
      watchlistRow({
        date: '03-08-2026', stock: 'ALREADYHIT', buyRange: '100-110', sl: '95 (-5%)', tp1: '120 (10%)',
        status: 'RUNNING', detailStatus: 'HIT TP 1, HOLD & SET TS DI BUY PRICE',
      }),
    ]);
    // parseWatchlistRows would drop this one entirely (highestTpReached >= 1).
    expect(parseWatchlistRows(rows, { now: TODAY })).toHaveLength(0);
    const raw = parseWatchlistRowsRaw(rows);
    expect(raw).toHaveLength(1);
    expect(raw[0].stock).toBe('ALREADYHIT');
    expect(raw[0].status).toBe('RUNNING');
    expect(raw[0].detailStatus).toBe('HIT TP 1, HOLD & SET TS DI BUY PRICE');
  });

  test('keeps rows missing SL/TP, unlike parseWatchlistRows', () => {
    const rows = grid([
      watchlistRow({
        date: '03-08-2026', stock: 'NOSTOP', buyRange: '100-110', sl: '-', tp1: '-', status: 'OPEN',
      }),
    ]);
    expect(parseWatchlistRows(rows, { now: TODAY })).toHaveLength(0);
    const raw = parseWatchlistRowsRaw(rows);
    expect(raw).toHaveLength(1);
    expect(raw[0].sl).toBe('-');
    expect(raw[0].tp1).toBe('-');
  });

  test('skips rows with no stock ticker', () => {
    const rows = grid([
      watchlistRow({ date: '03-08-2026', stock: '', buyRange: '100-110', sl: '95', tp1: '120', status: 'OPEN' }),
      watchlistRow({ date: '03-08-2026', stock: 'HASNAME', buyRange: '100-110', sl: '95', tp1: '120', status: 'OPEN' }),
    ]);
    const raw = parseWatchlistRowsRaw(rows);
    expect(raw.map((r) => r.stock)).toEqual(['HASNAME']);
  });
});

describe('buildWaSignal', () => {
  test('uses the midpoint of the buy range as entry, same rule as sheet signals', () => {
    const signal = buildWaSignal({ stock: 'ppre', buyLow: 101, buyHigh: 103, sl: 100, tp1: 110, tp2: 115, mmPercent: 9 });
    expect(signal.stock).toBe('PPRE');
    expect(signal.entry).toBe(102);
    expect(signal.buyLow).toBe(101);
    expect(signal.buyHigh).toBe(103);
    expect(signal.isOpen).toBe(true);
    expect(signal.isActionable).toBe(true);
    expect(signal.source).toBe('wa');
    expect(signal.tradeType).toBe('DAY TRADE');
  });

  test('keeps SWING TRADE when the WA announcement says so', () => {
    const signal = buildWaSignal({
      stock: 'ppre', tradeType: 'SWING TRADE', buyLow: 101, buyHigh: 103, sl: 100, tp1: 110,
    });
    expect(signal.tradeType).toBe('SWING TRADE');
    expect(signal.entry).toBe(102);
  });

  test('rounds a fractional midpoint up, not down', () => {
    const signal = buildWaSignal({ stock: 'ODD', buyLow: 151, buyHigh: 152, sl: 145, tp1: 160 });
    expect(signal.entry).toBe(152);
  });

  test('entryMode "low" uses the bottom of the buy range', () => {
    const signal = buildWaSignal({
      stock: 'ppre', buyLow: 101, buyHigh: 103, sl: 100, tp1: 110, entryMode: 'low',
    });
    expect(signal.entry).toBe(101);
  });

  test('entryMode "high" uses the top of the buy range', () => {
    const signal = buildWaSignal({
      stock: 'ppre', buyLow: 101, buyHigh: 103, sl: 100, tp1: 110, entryMode: 'high',
    });
    expect(signal.entry).toBe(103);
  });

  test('score uses the midpoint of TP1/TP2 when TP2 is known, not TP1 alone', () => {
    // entry = 105, SL 100 -> 4.76% away, TP1 120 (14.29%), TP2 130.
    // score basis = midpoint(120, 130) = 125 -> 19.05% away -> score ~= 4, not the
    // TP1-only score of 3 (see the "computes score as TP1% divided by SL%" test above).
    const withTp2 = buildWaSignal({ stock: 'A', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120, tp2: 130 });
    const withoutTp2 = buildWaSignal({ stock: 'B', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120 });
    expect(withTp2.score).toBeCloseTo(4, 1);
    expect(withoutTp2.score).toBeCloseTo(3, 2);
    // TP1's own displayed percentage is unaffected by TP2 being present.
    expect(withTp2.tp1Percent).toBeCloseTo(withoutTp2.tp1Percent, 5);
  });

  test('tpMid is the midpoint of TP1/TP2 when TP2 exists, else just TP1', () => {
    const withTp2 = buildWaSignal({ stock: 'A', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120, tp2: 130 });
    const withoutTp2 = buildWaSignal({ stock: 'B', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120 });
    expect(withTp2.tpMid).toBe(125);
    expect(withoutTp2.tpMid).toBe(120);
  });

  test('tpMode "separate" scores off TP1 alone, ignoring TP2 - tpMid is still returned for reference', () => {
    const signal = buildWaSignal({
      stock: 'A', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120, tp2: 130, tpMode: 'separate',
    });
    expect(signal.score).toBeCloseTo(3, 2);
    expect(signal.tpMid).toBe(125);
  });

  test('ageDays is 0 (Terbit hari ini) when the stock has no current watchlistDate', () => {
    const signal = buildWaSignal({ stock: 'A', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120 });
    expect(signal.ageDays).toBe(0);
  });

  test('ageDays follows watchlistDate when the stock is currently on the watchlist', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const signal = buildWaSignal({
      stock: 'A', buyLow: 100, buyHigh: 110, sl: 100, tp1: 120, watchlistDate: threeDaysAgo,
    });
    expect(signal.ageDays).toBe(3);
  });
});

describe('computeTpMid', () => {
  test('averages and rounds TP1/TP2 when TP2 exists', () => {
    expect(computeTpMid(100, 111)).toBe(106);
  });

  test('falls back to TP1 alone when TP2 is missing', () => {
    expect(computeTpMid(120, null)).toBe(120);
  });
});

describe('mergeSignalSources', () => {
  test('drops a WA signal once the sheet has the same stock', () => {
    const sheetSignals = [{ stock: 'MEDC' }];
    const waSignals = [{ stock: 'medc' }, { stock: 'PGEO' }];
    const { combined, staleWaStocks } = mergeSignalSources(sheetSignals, waSignals);
    expect(combined.map((s) => s.stock)).toEqual(['MEDC', 'PGEO']);
    expect(staleWaStocks).toEqual(['MEDC']);
  });
});

describe('positionSize', () => {
  test('divides fixed risk rupiah by the SL distance percentage', () => {
    // 50jt capital, 0.5% risk = Rp250,000 risk. Entry 3530, SL 3450 -> 2.2663% away.
    const { rupiah, lembar } = positionSize(3530, 3450, 50_000_000, 0.005);
    expect(rupiah).toBeCloseTo(250_000 / (80 / 3530), -3);
    expect(lembar % 100).toBe(0);
  });
});

describe('rankSignals', () => {
  function signal(stock, { entry, sl, tp1, score, ageDays = 0, isOpen = true, isRunning = false, mmPercent = null } = {}) {
    const e = entry ?? 100;
    const s = sl ?? 95;
    const t = tp1 ?? 110;
    return {
      stock, entry: e, sl: s, tp1: t, tp2: null, tp3: null, ageDays, mmPercent,
      score: score ?? Math.abs((t - e) / e) / Math.abs((e - s) / e),
      isOpen, isRunning, isActionable: isOpen, status: isOpen ? 'OPEN' : 'RUNNING', detailStatus: '',
      highestTpReached: 0, source: 'sheet',
    };
  }

  test('regression: splits budget across candidates actually present, not full slot capacity', () => {
    // Bug found 2026-08-03: with 4 empty slots but only 2 real candidates,
    // budget was wrongly divided by 4 instead of 2.
    const signals = [signal('A', { entry: 1000, sl: 970 }), signal('B', { entry: 500, sl: 480 })];
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 20_000_000,
      maxSlots: 6, occupiedSlots: 2, journaledStocks: new Set(),
    });
    // 4 slots available (6-2), but only 2 candidates -> budget split two ways
    // (10,000,000 each), not four ways (5,000,000 each).
    const a = ranked.find((r) => r.stock === 'A');
    const b = ranked.find((r) => r.stock === 'B');
    expect(a.willSkip).toBe(false);
    expect(b.willSkip).toBe(false);
    // A's ideal risk-based size is ~8,333,333, which fits inside a half-split
    // budget (10,000,000) but would be clipped by a quarter-split one (5,000,000).
    expect(a.position.rupiah).toBeGreaterThan(6_000_000);
  });

  test('marks candidates beyond available slots as slot-penuh', () => {
    const signals = [
      signal('A', { score: 3 }), signal('B', { score: 2 }), signal('C', { score: 1 }),
    ];
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 50_000_000,
      maxSlots: 6, occupiedSlots: 4, journaledStocks: new Set(), // only 2 slots free
    });
    const skipped = ranked.filter((r) => r.skipReason === 'slot-penuh');
    expect(skipped.map((r) => r.stock)).toEqual(['C']);
  });

  test('a stock already in the journal is marked sudah-terbeli and does not consume budget', () => {
    const signals = [signal('OWNED', { entry: 1000, sl: 970 }), signal('FRESH', { entry: 1000, sl: 970 })];
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 10_000_000,
      maxSlots: 6, occupiedSlots: 0, journaledStocks: new Set(['OWNED']),
    });
    const owned = ranked.find((r) => r.stock === 'OWNED');
    const fresh = ranked.find((r) => r.stock === 'FRESH');
    expect(owned.skipReason).toBe('sudah-terbeli');
    expect(owned.owned).toBe(true);
    expect(fresh.willSkip).toBe(false);
    // FRESH's ideal risk-based size is ~8,333,333, which fits the full
    // 10,000,000 budget (OWNED doesn't compete for a slot) but would be
    // clipped to 5,000,000 if OWNED wrongly still split the budget.
    expect(fresh.position.rupiah).toBeGreaterThan(6_000_000);
  });

  test('caps a position size to the per-slot budget and flags it as adjusted', () => {
    const signals = [signal('BIG', { entry: 444, sl: 438 })]; // needs ~18.5jt ideal
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 5_000_000,
      maxSlots: 6, occupiedSlots: 0, journaledStocks: new Set(),
    });
    const [big] = ranked;
    expect(big.willSkip).toBe(false);
    expect(big.adjusted).toBe(true);
    expect(big.position.rupiah).toBeLessThanOrEqual(5_000_000);
  });

  test('marks modal-habis when even the split budget cannot cover 1 lot', () => {
    const signals = [signal('EXPENSIVE', { entry: 100_000, sl: 99_000 })];
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 500, // way too little
      maxSlots: 6, occupiedSlots: 0, journaledStocks: new Set(),
    });
    expect(ranked[0].skipReason).toBe('modal-habis');
  });

  test('non-OPEN signals pass through without competing for slots or budget', () => {
    const signals = [signal('RUNNER', { isOpen: false, isRunning: true })];
    const ranked = rankSignals(signals, {
      capital: 50_000_000, riskPercent: 0.005, remainingCapital: 50_000_000,
      maxSlots: 6, occupiedSlots: 0, journaledStocks: new Set(),
    });
    expect(ranked[0].willSkip).toBe(false);
    expect(ranked[0].position).toBeNull();
  });
});

describe('partitionByDate', () => {
  test('splits signals into today vs previous by ageDays, not status', () => {
    const signals = [
      { stock: 'TODAY_OPEN', ageDays: 0, willSkip: false, score: 1 },
      { stock: 'TODAY_RUNNING', ageDays: 0, willSkip: false, score: 2 },
      { stock: 'OLD_OPEN', ageDays: 3, willSkip: false, score: 5 },
    ];
    const { today, previous } = partitionByDate(signals);
    expect(today.map((s) => s.stock).sort()).toEqual(['TODAY_OPEN', 'TODAY_RUNNING'].sort());
    expect(previous.map((s) => s.stock)).toEqual(['OLD_OPEN']);
  });

  test('sorts each bucket with non-skipped first, then by score', () => {
    const signals = [
      { stock: 'LOW_SCORE', ageDays: 0, willSkip: false, score: 1 },
      { stock: 'SKIPPED_HIGH_SCORE', ageDays: 0, willSkip: true, score: 9 },
      { stock: 'HIGH_SCORE', ageDays: 0, willSkip: false, score: 5 },
    ];
    const { today } = partitionByDate(signals);
    expect(today.map((s) => s.stock)).toEqual(['HIGH_SCORE', 'LOW_SCORE', 'SKIPPED_HIGH_SCORE']);
  });
});

describe('parseWaMessageText', () => {
  test('parses a standard single-signal WA message with "SL :" style', () => {
    const text = 'DAY TRADE - BUY BBRI : 4500-4550\nSL : 4400\nTP 1 : 4700\nTP 2 : 4800\nMM : 9% EQUITY';
    const [signal] = parseWaMessageText(text);
    expect(signal).toMatchObject({
      stock: 'BBRI', tradeType: 'DAY TRADE', buyLow: 4500, buyHigh: 4550,
      sl: 4400, tp1: 4700, tp2: 4800, mmPercent: 9, confidence: 'high',
    });
  });

  test('parses "SL IF CLOSE <" style and Indonesian thousands separators', () => {
    const text = 'SWING TRADE - BUY MEDC : 1.200-1.250\nSL IF CLOSE < 1.150\nTP 1 : 1.400\nMM : 12% EQUITY';
    const [signal] = parseWaMessageText(text);
    expect(signal).toMatchObject({
      stock: 'MEDC', tradeType: 'SWING TRADE', buyLow: 1200, buyHigh: 1250, sl: 1150, tp1: 1400, mmPercent: 12,
    });
    expect(signal.tp2).toBeUndefined();
  });

  test('treats a duplicated "TP 1" line as TP2 when its number is higher', () => {
    const text = 'DAY TRADE - BUY ASII : 5000-5100\nSL : 4900\nTP 1 : 5300\nTP 1 : 5500\nMM : 8% EQUITY';
    const [signal] = parseWaMessageText(text);
    expect(signal.tp1).toBe(5300);
    expect(signal.tp2).toBe(5500);
  });

  test('parses multiple signals in one pasted message', () => {
    const text = [
      'DAY TRADE - BUY BBCA : 9000-9100',
      'SL : 8800',
      'TP 1 : 9500',
      'MM : 10% EQUITY',
      '',
      'SWING TRADE - BUY TLKM : 3000-3050',
      'SL : 2900',
      'TP 1 : 3300',
      'TP 2 : 3500',
      'MM : 7% EQUITY',
    ].join('\n');
    const signals = parseWaMessageText(text);
    expect(signals.map((s) => s.stock)).toEqual(['BBCA', 'TLKM']);
    expect(signals[1]).toMatchObject({ tp1: 3300, tp2: 3500 });
  });

  test('returns an empty array for text that does not match the WA format', () => {
    expect(parseWaMessageText('halo, ada info saham bagus gak hari ini?')).toEqual([]);
  });

  test('skips a block missing a required field (e.g. no SL) instead of throwing', () => {
    const text = 'DAY TRADE - BUY UNVR : 4000-4050\nTP 1 : 4200\nMM : 5% EQUITY';
    expect(parseWaMessageText(text)).toEqual([]);
  });
});
