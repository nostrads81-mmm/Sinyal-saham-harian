const { computeCalculator, parseCalculatorInputs } = require('./calculator');
const { computeNetPnl } = require('./pnl');

const SETTINGS = {
  buyFeePercent: 0.0015,
  sellFeePercent: 0.0025,
  materaiThreshold: 10_000_000,
  materaiAmount: 10_000,
};

describe('computeCalculator', () => {
  test('sizes the position so a full stop-out loses no more than the budgeted max loss', () => {
    // entry 1000, SL 950 (5% jarak), maks rugi 500rb -> budget beli 10jt ->
    // 100 lot (10.000 lembar) di harga 1000 = 10jt persis.
    const result = computeCalculator({ entry: 1000, sl: 950, tp: 1100, maxLoss: 500_000 }, SETTINGS);

    expect(result.lot).toBe(100);
    expect(result.rupiahBeli).toBe(10_000_000);
    // Same formula computeNetPnl itself uses elsewhere - fees/materai make
    // the real loss somewhat bigger than the raw maxLoss budget, not a
    // coincidence to assert a magic number against.
    expect(result.slEstimate.pnlRp).toBeCloseTo(computeNetPnl(1000, 950, 100, SETTINGS).pnlRp);
    expect(result.slEstimate.pnlRp).toBeLessThan(0);
    expect(result.tpEstimate.pnlRp).toBeCloseTo(computeNetPnl(1000, 1100, 100, SETTINGS).pnlRp);
    expect(result.tpEstimate.pnlRp).toBeGreaterThan(0);
  });

  test('rounds the lot count down, never up past the max-loss budget', () => {
    // Budget computes to a fraction of a lot - should floor to 0, not round up.
    const result = computeCalculator({ entry: 10_000, sl: 9_900, tp: 10_500, maxLoss: 1000 }, SETTINGS);
    expect(result.lot).toBe(0);
    expect(result.rupiahBeli).toBe(0);
    expect(result.slEstimate).toBeNull();
    expect(result.tpEstimate).toBeNull();
  });

  test('tp is optional - result still comes back with a null tpEstimate', () => {
    const result = computeCalculator({ entry: 1000, sl: 950, tp: null, maxLoss: 500_000 }, SETTINGS);
    expect(result.lot).toBeGreaterThan(0);
    expect(result.tpEstimate).toBeNull();
  });

  test('returns null when SL is not below entry (not a valid long setup)', () => {
    expect(computeCalculator({ entry: 1000, sl: 1000, tp: 1100, maxLoss: 500_000 }, SETTINGS)).toBeNull();
    expect(computeCalculator({ entry: 1000, sl: 1050, tp: 1100, maxLoss: 500_000 }, SETTINGS)).toBeNull();
  });

  test('returns null when a required field is missing or non-positive', () => {
    expect(computeCalculator({ entry: 0, sl: 950, tp: 1100, maxLoss: 500_000 }, SETTINGS)).toBeNull();
    expect(computeCalculator({ entry: 1000, sl: 0, tp: 1100, maxLoss: 500_000 }, SETTINGS)).toBeNull();
    expect(computeCalculator({ entry: 1000, sl: 950, tp: 1100, maxLoss: 0 }, SETTINGS)).toBeNull();
    expect(computeCalculator({ entry: 1000, sl: 950, tp: 1100, maxLoss: null }, SETTINGS)).toBeNull();
  });
});

describe('parseCalculatorInputs', () => {
  test('parses the four raw strings the Kalkulator form collects', () => {
    const parsed = parseCalculatorInputs({
      entryInput: '3550', slInput: '3500', tpInput: '3750', maxLossInput: '450000',
    });
    expect(parsed).toEqual({ entry: 3550, sl: 3500, tp: 3750, maxLoss: 450_000 });
  });

  // The exact pipeline the "Hitung" button runs: parse the typed strings,
  // then feed the result straight into computeCalculator. This is the test
  // that would have caught the field named maksKerugian here not matching
  // the maxLoss computeCalculator expects - each function's own unit tests
  // used clean, already-matching object literals and both passed anyway.
  test('end to end: parsed output feeds computeCalculator and actually sizes a position', () => {
    const parsed = parseCalculatorInputs({
      entryInput: '3550', slInput: '3500', tpInput: '3750', maxLossInput: '450000',
    });
    const result = computeCalculator(parsed, SETTINGS);
    expect(result).not.toBeNull();
    expect(result.lot).toBeGreaterThan(0);
  });

  test('tp is optional - an empty TP string parses to null, not an error', () => {
    const parsed = parseCalculatorInputs({
      entryInput: '1000', slInput: '950', tpInput: '', maxLossInput: '500000',
    });
    expect(parsed.tp).toBeNull();
  });

  test('rejects SL that is not below entry, with a message instead of a crash', () => {
    const parsed = parseCalculatorInputs({
      entryInput: '1000', slInput: '1000', tpInput: '1100', maxLossInput: '500000',
    });
    expect(parsed.error).toBe('SL harus lebih kecil dari Entry.');
  });

  test('rejects a missing required field with a specific message', () => {
    expect(parseCalculatorInputs({ entryInput: '', slInput: '950', tpInput: '', maxLossInput: '500000' }).error)
      .toBe('Entry wajib diisi');
    expect(parseCalculatorInputs({ entryInput: '1000', slInput: '', tpInput: '', maxLossInput: '500000' }).error)
      .toBe('SL wajib diisi');
    expect(parseCalculatorInputs({ entryInput: '1000', slInput: '950', tpInput: '', maxLossInput: '' }).error)
      .toBe('Maks kerugian wajib diisi');
  });
});
