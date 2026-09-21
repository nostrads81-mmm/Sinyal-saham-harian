const { parseHargaInput, parseLotInput } = require('./journalInput');

describe('parseHargaInput', () => {
  test('keeps an empty field empty so the caller keeps its own fallback', () => {
    expect(parseHargaInput('')).toEqual({ value: null, error: null });
    expect(parseHargaInput('   ')).toEqual({ value: null, error: null });
    expect(parseHargaInput(undefined)).toEqual({ value: null, error: null });
    expect(parseHargaInput(null)).toEqual({ value: null, error: null });
  });

  test('accepts a normal price, trimmed and as either string or number', () => {
    expect(parseHargaInput('1000')).toEqual({ value: 1000, error: null });
    expect(parseHargaInput(' 250 ')).toEqual({ value: 250, error: null });
    expect(parseHargaInput(4500)).toEqual({ value: 4500, error: null });
  });

  test('rejects zero, negatives and anything that is not a real number', () => {
    for (const raw of ['0', '-5', 'abc', '1.2.3', 'NaN', 'Infinity', '-0.01']) {
      const result = parseHargaInput(raw);
      expect(result.value).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });

  test('treats a comma as the decimal separator (1,5 -> 1.5)', () => {
    expect(parseHargaInput('1,5')).toEqual({ value: 1.5, error: null });
  });

  // Known gap, recorded openly instead of hidden: "1.000" is how an Indonesian
  // user writes one thousand, and Number() reads it as 1 - so the price lands
  // in the journal as Rp1. Not "fixed" here because the fix (a dot as a
  // thousands separator) would break genuine decimal prices, and that trade-off
  // is the owner's call, not a bug I should silently pick a side on.
  test('an Indonesian thousands separator is still read as a decimal point', () => {
    expect(parseHargaInput('1.000').value).toBe(1);
  });
});

describe('parseLotInput', () => {
  test('keeps an empty field empty so an unrecorded lot stays an estimate', () => {
    expect(parseLotInput('')).toEqual({ value: null, error: null });
    expect(parseLotInput(undefined)).toEqual({ value: null, error: null });
  });

  test('accepts whole lots', () => {
    expect(parseLotInput('1')).toEqual({ value: 1, error: null });
    expect(parseLotInput('31')).toEqual({ value: 31, error: null });
    expect(parseLotInput(3100)).toEqual({ value: 3100, error: null });
  });

  test('rejects zero, negatives and fractional lots', () => {
    for (const raw of ['0', '-3', '1.5', '2,5', 'abc', '31 lot']) {
      const result = parseLotInput(raw);
      expect(result.value).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });
});