const {
  daysHeld, computeNetPnl, sumRealizedPnl, sumPartialSellLot, computeEntryTotalPnl,
} = require('./pnl');

// Same shape getSettings() returns from the Settings tab.
const SETTINGS = {
  buyFeePercent: 0.0015,
  sellFeePercent: 0.0025,
};

describe('daysHeld', () => {
  test('counts whole days between two journal dates', () => {
    expect(daysHeld('20-09-2026', '21-09-2026')).toBe(1);
    expect(daysHeld('20-09-2026', '20-09-2026')).toBe(0);
    expect(daysHeld('30-09-2026', '02-10-2026')).toBe(2);
  });

  test('returns null instead of NaN when a date is missing or malformed', () => {
    expect(daysHeld('20-09-2026', '')).toBeNull();
    expect(daysHeld(undefined, '21-09-2026')).toBeNull();
    expect(daysHeld('2026-09-20', '21-09-2026')).toBeNull();
  });
});

describe('computeNetPnl', () => {
  test('subtracts buy/sell fees from the raw price difference', () => {
    // 10 lot = 1000 lembar: buy 1.000.000 x 1,0015 = 1.001.500,
    // sell 1.100.000 x 0,9975 = 1.097.250 -> +95.750 (bukan 100.000 mentah).
    const net = computeNetPnl(1000, 1100, 10, SETTINGS);

    expect(net.pnlRp).toBeCloseTo(95_750, 6);
    expect(net.pnlPercent).toBeCloseTo(9.5607, 3);
    expect(net.estimated).toBe(false);
  });

  test('a flat price still loses money, from fees alone', () => {
    // 200 lot at 1000 = 20jt tiap sisi: buy 20.030.000, sell 19.950.000.
    const net = computeNetPnl(1000, 1000, 200, SETTINGS);

    expect(net.pnlRp).toBeCloseTo(-80_000, 6);
    expect(net.pnlPercent).toBeLessThan(0);
  });

  test('no stamp duty (materai) regardless of transaction size - dropped after real broker statements showed it is not actually charged', () => {
    // 100 lot at 1050 = 10,5jt tiap sisi - well past what used to be modeled
    // as the materai threshold, but the fee stays pure percentage.
    const net = computeNetPnl(1050, 1050, 100, SETTINGS);
    expect(net.pnlRp).toBeCloseTo(-42_000, 6); // murni fee, tanpa materai
  });

  test('falls back to a fee-free estimate when the lot was never recorded', () => {
    const net = computeNetPnl(1000, 1100, 0, SETTINGS);

    expect(net.estimated).toBe(true);
    expect(net.pnlRp).toBeNull();
    expect(net.pnlPercent).toBeCloseTo(10, 6);
  });

  test('returns null when either price is missing', () => {
    expect(computeNetPnl(0, 1100, 10, SETTINGS)).toBeNull();
    expect(computeNetPnl(1000, null, 10, SETTINGS)).toBeNull();
  });
});

describe('sumRealizedPnl', () => {
  test('sums net P&L across every closed entry, ignoring open/running ones', () => {
    const entries = [
      { status: 'CLOSE-PROFIT', entry: 100, hargaExit: 110, catatan: 'Lot: 10' },
      { status: 'CLOSE-LOSS', entry: 200, hargaExit: 190, catatan: 'Lot: 5' },
      { status: 'RUNNING', entry: 300, hargaExit: null, catatan: 'Lot: 20' },
    ];
    const expected = computeNetPnl(100, 110, 10, SETTINGS).pnlRp
      + computeNetPnl(200, 190, 5, SETTINGS).pnlRp;
    expect(sumRealizedPnl(entries, SETTINGS)).toBeCloseTo(expected);
  });

  test('returns 0 when there are no closed entries', () => {
    const entries = [{ status: 'RUNNING', entry: 100, hargaExit: null, catatan: 'Lot: 1' }];
    expect(sumRealizedPnl(entries, SETTINGS)).toBe(0);
  });

  test('entries with no recorded lot (pre-fee-tracking, estimate-only) contribute nothing', () => {
    const entries = [{ status: 'CLOSE-PROFIT', entry: 100, hargaExit: 110, catatan: '' }];
    expect(sumRealizedPnl(entries, SETTINGS)).toBe(0);
  });

  test('a RUNNING row with partial sells counts those sells as realized already', () => {
    const entries = [{
      status: 'RUNNING', entry: 100, hargaExit: null, catatan: 'Lot: 20',
      partialSells: [{ tanggal: "'01-10-2026", hargaExit: 110, lot: 10 }],
    }];
    expect(sumRealizedPnl(entries, SETTINGS)).toBeCloseTo(computeNetPnl(100, 110, 10, SETTINGS).pnlRp);
  });

  test('a fully CLOSED row with partial sells counts both the sells AND the remaining lot at the final exit', () => {
    const entries = [{
      status: 'CLOSE-PROFIT', entry: 100, hargaExit: 120, catatan: 'Lot: 20',
      partialSells: [{ tanggal: "'01-10-2026", hargaExit: 110, lot: 10 }],
    }];
    const expected = computeNetPnl(100, 110, 10, SETTINGS).pnlRp
      + computeNetPnl(100, 120, 10, SETTINGS).pnlRp; // remaining 10 lot at the final close price
    expect(sumRealizedPnl(entries, SETTINGS)).toBeCloseTo(expected);
  });
});

describe('sumPartialSellLot', () => {
  test('sums lot across every recorded partial sell', () => {
    expect(sumPartialSellLot([{ lot: 5 }, { lot: 3 }])).toBe(8);
  });

  test('0 for no sells recorded (null or empty)', () => {
    expect(sumPartialSellLot(null)).toBe(0);
    expect(sumPartialSellLot([])).toBe(0);
  });
});

describe('computeEntryTotalPnl', () => {
  test('a plain closed row (no partial sells) matches computeNetPnl on the full lot', () => {
    const entry = { entry: 100, hargaExit: 120, catatan: 'Lot: 20', status: 'CLOSE-PROFIT' };
    const expected = computeNetPnl(100, 120, 20, SETTINGS);
    const got = computeEntryTotalPnl(entry, SETTINGS);
    expect(got.pnlRp).toBeCloseTo(expected.pnlRp);
    expect(got.pnlPercent).toBeCloseTo(expected.pnlPercent);
  });

  test('blends a partial sell with the final exit on the remaining lot, weighted by buy cost', () => {
    const entry = {
      entry: 100, hargaExit: 120, catatan: 'Lot: 20', status: 'CLOSE-PROFIT',
      partialSells: [{ tanggal: "'01-10-2026", hargaExit: 110, lot: 10 }],
    };
    const partial = computeNetPnl(100, 110, 10, SETTINGS);
    const rest = computeNetPnl(100, 120, 10, SETTINGS);
    const got = computeEntryTotalPnl(entry, SETTINGS);
    expect(got.pnlRp).toBeCloseTo(partial.pnlRp + rest.pnlRp);
    // Buy cost for each 10-lot piece is identical, so the blended percent is
    // just their average here - not true in general when lot sizes differ.
    expect(got.pnlPercent).toBeCloseTo((partial.pnlPercent + rest.pnlPercent) / 2);
  });

  test('a RUNNING row that is only partially sold counts just the sold lot, not the still-open remainder', () => {
    const entry = {
      entry: 100, hargaExit: null, catatan: 'Lot: 20', status: 'RUNNING',
      partialSells: [{ tanggal: "'01-10-2026", hargaExit: 110, lot: 10 }],
    };
    const expected = computeNetPnl(100, 110, 10, SETTINGS);
    const got = computeEntryTotalPnl(entry, SETTINGS);
    expect(got.pnlRp).toBeCloseTo(expected.pnlRp);
    expect(got.pnlPercent).toBeCloseTo(expected.pnlPercent);
  });

  test('returns null when nothing has been sold yet', () => {
    const entry = { entry: 100, hargaExit: null, catatan: 'Lot: 20', status: 'RUNNING' };
    expect(computeEntryTotalPnl(entry, SETTINGS)).toBeNull();
  });

  test('returns null when there is no entry price recorded', () => {
    expect(computeEntryTotalPnl({ entry: null, hargaExit: 120, catatan: 'Lot: 20' }, SETTINGS)).toBeNull();
  });
});