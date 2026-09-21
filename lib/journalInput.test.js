const { parseHargaInput, parseLotInput, localizeNumber } = require('./journalInput');

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

  test('reads an Indonesian thousands separator as thousands, not a decimal', () => {
    // "1.000" used to land in the journal as Rp1; now it is one thousand.
    expect(parseHargaInput('1.000')).toEqual({ value: 1000, error: null });
    expect(parseHargaInput('1.000.000')).toEqual({ value: 1000000, error: null });
    expect(parseHargaInput('12.345')).toEqual({ value: 12345, error: null });
    // A real decimal point (fewer/more than three digits) is left alone.
    expect(parseHargaInput('1.5')).toEqual({ value: 1.5, error: null });
    expect(parseHargaInput('0.005')).toEqual({ value: 0.005, error: null });
    // Mixed Indonesian style: thousands with a dot, decimals with a comma.
    expect(parseHargaInput('1.500,5')).toEqual({ value: 1500.5, error: null });
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
    expect(parseLotInput('1.000')).toEqual({ value: 1000, error: null });
  });

  test('rejects zero, negatives and fractional lots', () => {
    for (const raw of ['0', '-3', '1.5', '2,5', 'abc', '31 lot']) {
      const result = parseLotInput(raw);
      expect(result.value).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });
});