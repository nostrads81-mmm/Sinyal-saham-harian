const {
  computeCalculator, parseCalculatorInputs, computeRiskRewardRatio, suggestEntryForRatio,
} = require('./calculator');
const { computeNetPnl } = require('./pnl');

const SETTINGS = {
  buyFeePercent: 0.0015,
  sellFeePercent: 0.0025,
  materaiThreshold: 10_000_000,
  materaiAmount: 10_000,
};

describe('computeCalculator', () => {
  test('sizes the position so the REAL loss at SL (fees/materai included) never exceeds the budgeted max loss', () => {
    const result = computeCalculator({ entry: 1000, sl: 950, tp: 1100, maxLoss: 500_000 }, SETTINGS);

    expect(result.lot).toBe(92);
    expect(result.rupiahBeli).toBe(9_200_000);
    // The whole point of sizing this way - the actual loss computeNetPnl
    // reports must fit inside the budget the user typed, not just come
    // close by coincidence.
    expect(result.slEstimate.pnlRp).toBeCloseTo(computeNetPnl(1000, 950, 92, SETTINGS).pnlRp);
    expect(Math.abs(result.slEstimate.pnlRp)).toBeLessThanOrEqual(500_000);
    expect(result.slEstimate.pnlRp).toBeLessThan(0);
    // One more lot would already break the budget - proves the loop
    // actually walked down to the boundary instead of just ending up
    // somewhere safely under it by chance.
    expect(Math.abs(computeNetPnl(1000, 950, 93, SETTINGS).pnlRp)).toBeGreaterThan(500_000);
    expect(result.tpEstimate.pnlRp).toBeCloseTo(computeNetPnl(1000, 1100, 92, SETTINGS).pnlRp);
    expect(result.tpEstimate.pnlRp).toBeGreaterThan(0);
    // entry 1000, SL 950 (risk 50), TP 1100 (reward 100) -> 1:2.
    expect(result.ratio).toBeCloseTo(2);
  });

  test('the materai flat fee (hit only once the trade crosses the threshold) never pushes the real loss over budget', () => {
    // Large enough that both sides of the trade cross the Rp10jt materai
    // threshold - the exact case that used to size past the typed budget
    // before materai/fees were accounted for in the sizing itself.
    const result = computeCalculator({ entry: 1610, sl: 1590, tp: 1660, maxLoss: 450_000 }, SETTINGS);

    expect(Math.abs(result.slEstimate.pnlRp)).toBeLessThanOrEqual(450_000);
    expect(Math.abs(computeNetPnl(1610, 1590, result.lot + 1, SETTINGS).pnlRp)).toBeGreaterThan(450_000);
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

describe('computeRiskRewardRatio', () => {
  test('reads as "reward per 1 unit of risk" - a result of 5 is a 1:5 setup', () => {
    // entry 1000, SL 950 (risk 50), TP 1250 (reward 250) -> 250/50 = 1:5.
    expect(computeRiskRewardRatio(1000, 950, 1250)).toBeCloseTo(5);
  });

  test('null when there is no TP, or SL is not below entry', () => {
    expect(computeRiskRewardRatio(1000, 950, null)).toBeNull();
    expect(computeRiskRewardRatio(1000, 950, 0)).toBeNull();
    expect(computeRiskRewardRatio(1000, 1000, 1250)).toBeNull();
    expect(computeRiskRewardRatio(1000, 1050, 1250)).toBeNull();
  });
});

describe('suggestEntryForRatio', () => {
  test('gives the entry that reaches the desired ratio without moving TP or SL', () => {
    // SL 950, TP 1250 fixed - for 1:5, entry should be 1000 (same numbers
    // as the computeRiskRewardRatio test above, just solved the other way).
    const entry = suggestEntryForRatio(950, 1250, 5);
    expect(entry).toBeCloseTo(1000);
    expect(computeRiskRewardRatio(entry, 950, 1250)).toBeCloseTo(5);
  });

  test('works for a non-round desired ratio too, round-tripping through computeRiskRewardRatio', () => {
    const entry = suggestEntryForRatio(3500, 3750, 2.5);
    expect(computeRiskRewardRatio(entry, 3500, 3750)).toBeCloseTo(2.5);
  });

  test('null when TP is not above SL, or the ratio is not a usable positive number', () => {
    expect(suggestEntryForRatio(1000, 1000, 5)).toBeNull();
    expect(suggestEntryForRatio(1000, 900, 5)).toBeNull();
    expect(suggestEntryForRatio(950, 1250, 0)).toBeNull();
    expect(suggestEntryForRatio(950, 1250, -1)).toBeNull();
    expect(suggestEntryForRatio(950, 1250, null)).toBeNull();
  });
});
