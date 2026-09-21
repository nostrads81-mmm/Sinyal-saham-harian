const { daysHeld, computeNetPnl } = require('./pnl');

// Same shape getSettings() returns from the Settings tab.
const SETTINGS = {
  buyFeePercent: 0.0015,
  sellFeePercent: 0.0025,
  materaiThreshold: 10_000_000,
  materaiAmount: 10_000,
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

  test('a flat price still loses money once fees and materai are counted', () => {
    // 200 lot at 1000 = 20jt tiap sisi, jadi materai 10rb kena dua kali.
    const net = computeNetPnl(1000, 1000, 200, SETTINGS);

    expect(net.pnlRp).toBeCloseTo(-100_000, 6);
    expect(net.pnlPercent).toBeLessThan(0);
  });

  test('charges materai only above the threshold, and only once per side', () => {
    // Tepat 10jt: perbandingannya "lebih besar dari", jadi materai belum kena.
    const exactlyAtThreshold = computeNetPnl(1000, 1000, 100, SETTINGS);
    expect(exactlyAtThreshold.pnlRp).toBeCloseTo(-40_000, 6); // murni fee

    // 10,5jt tiap sisi -> materai kena di beli dan di jual.
    const aboveThreshold = computeNetPnl(1050, 1050, 100, SETTINGS);
    expect(aboveThreshold.pnlRp).toBeCloseTo(-62_000, 6);
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