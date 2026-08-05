function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    clear: () => { store = {}; },
  };
}

// dismissedSignals.js gates every read/write behind `typeof window`, so the
// default node test environment needs both globals faked before the module
// (which reads localStorage at call time, not at import time) is used.
global.window = {};
global.localStorage = makeLocalStorageMock();

const {
  getDismissedSignals, dismissSignal, pruneStaleDismissals,
} = require('./dismissedSignals');

beforeEach(() => {
  global.localStorage.clear();
});

test('dismissing a stock hides it regardless of case', () => {
  dismissSignal('hexa');
  expect(getDismissedSignals()).toContain('HEXA');
});

test('reads pre-rework string entries ("STOCK|DATE") without dropping them', () => {
  global.localStorage.setItem('dismissed_signals', JSON.stringify(['HEXA|2026-08-04', 'WTON']));
  expect(getDismissedSignals().sort()).toEqual(['HEXA', 'WTON']);
});

test('pruneStaleDismissals keeps a migrated legacy entry (just-normalized, so it looks fresh)', () => {
  global.localStorage.setItem('dismissed_signals', JSON.stringify(['HEXA|2026-08-04']));
  pruneStaleDismissals(14);
  expect(getDismissedSignals()).toEqual(['HEXA']);
});

test('pruneStaleDismissals drops entries older than maxAgeDays', () => {
  const old = Date.now() - 20 * 24 * 60 * 60 * 1000;
  global.localStorage.setItem('dismissed_signals', JSON.stringify([{ stock: 'HEXA', dismissedAt: old }]));
  pruneStaleDismissals(14);
  expect(getDismissedSignals()).toEqual([]);
});
