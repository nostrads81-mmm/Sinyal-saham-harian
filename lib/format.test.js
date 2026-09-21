const {
  formatRupiah, formatRupiahRingkas, todayDDMMYYYY, parseDDMMYYYY, parseLotFromCatatan,
} = require('./format');

describe('formatRupiah', () => {
  test('groups thousands the Indonesian way and rounds to whole rupiah', () => {
    expect(formatRupiah(1234567)).toBe('Rp1.234.567');
    expect(formatRupiah(1234567.6)).toBe('Rp1.234.568');
    expect(formatRupiah(0)).toBe('Rp0');
    expect(formatRupiah(-25000)).toBe('Rp-25.000');
  });
});

describe('formatRupiahRingkas', () => {
  test('uses juta for millions, trimming pointless decimals', () => {
    expect(formatRupiahRingkas(8_333_333)).toBe('Rp8,33 jt');
    expect(formatRupiahRingkas(1_800_000)).toBe('Rp1,8 jt');
    expect(formatRupiahRingkas(10_000_000)).toBe('Rp10 jt');
    expect(formatRupiahRingkas(1_000_000)).toBe('Rp1 jt');
  });

  test('uses ribu below a million', () => {
    expect(formatRupiahRingkas(850_000)).toBe('Rp850 rb');
    expect(formatRupiahRingkas(2_500)).toBe('Rp2,5 rb');
    expect(formatRupiahRingkas(1_000)).toBe('Rp1 rb');
  });

  test('keeps the plain form for small amounts and negatives stay readable', () => {
    expect(formatRupiahRingkas(999)).toBe('Rp999');
    expect(formatRupiahRingkas(0)).toBe('Rp0');
    expect(formatRupiahRingkas(-100_000)).toBe('-Rp100 rb');
    expect(formatRupiahRingkas(-1_500_000)).toBe('-Rp1,5 jt');
  });
});

describe('todayDDMMYYYY', () => {
  test('pads day and month to two digits', () => {
    expect(todayDDMMYYYY(new Date(2026, 8, 21))).toBe('21-09-2026');
    expect(todayDDMMYYYY(new Date(2026, 0, 5))).toBe('05-01-2026');
  });

  test('uses the local date, not UTC', () => {
    // Late-evening local time is already "tomorrow" in UTC for UTC+7; the
    // journal must keep the date the user is actually trading.
    expect(todayDDMMYYYY(new Date(2026, 8, 21, 23, 30))).toBe('21-09-2026');
  });
});

describe('parseDDMMYYYY', () => {
  test('parses the journal date format', () => {
    const d = parseDDMMYYYY('21-09-2026');

    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September, 0-based
    expect(d.getDate()).toBe(21);
  });

  test('returns null for anything that is not that exact shape', () => {
    expect(parseDDMMYYYY('2026-09-21')).toBeNull();
    expect(parseDDMMYYYY('21/09/2026')).toBeNull();
    expect(parseDDMMYYYY('')).toBeNull();
    expect(parseDDMMYYYY(undefined)).toBeNull();
  });
});

describe('parseLotFromCatatan', () => {
  test('reads the lot back out of the Catatan text', () => {
    expect(parseLotFromCatatan('Lot: 31')).toBe(31);
    expect(parseLotFromCatatan('lot:5')).toBe(5);
  });

  test('returns 0 when no lot was recorded', () => {
    expect(parseLotFromCatatan('Lot: -')).toBe(0);
    expect(parseLotFromCatatan('')).toBe(0);
    expect(parseLotFromCatatan(undefined)).toBe(0);
    expect(parseLotFromCatatan('tanpa lot')).toBe(0);
  });
});