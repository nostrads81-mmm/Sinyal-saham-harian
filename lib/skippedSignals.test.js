function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    clear: () => { store = {}; },
  };
}

// skippedSignals.js gates every read/write behind `typeof window`, so the
// default node test environment needs both globals faked before the module
// (which reads localStorage at call time, not at import time) is used.
global.window = {};
global.localStorage = makeLocalStorageMock();

const {
  getSkippedSignals, skipSignal, unskipSignal, pruneStaleSkips,
} = require('./skippedSignals');

beforeEach(() => {
  global.localStorage.clear();
});

test('skipping a stock is tracked regardless of case', () => {
  skipSignal('hexa');
  expect(getSkippedSignals()).toContain('HEXA');
});

test('unskipSignal clears a skip so the stock competes for slots again', () => {
  skipSignal('hexa');
  expect(getSkippedSignals()).toContain('HEXA');
  unskipSignal('HEXA');
  expect(getSkippedSignals()).not.toContain('HEXA');
});

test('unskipSignal is a no-op when the stock was never skipped', () => {
  skipSignal('WTON');
  unskipSignal('HEXA');
  expect(getSkippedSignals()).toEqual(['WTON']);
});

test('pruneStaleSkips drops entries older than maxAgeDays', () => {
  const old = Date.now() - 20 * 24 * 60 * 60 * 1000;
  global.localStorage.setItem('skipped_signals_v1', JSON.stringify([{ stock: 'HEXA', skippedAt: old }]));
  pruneStaleSkips(14);
  expect(getSkippedSignals()).toEqual([]);
});

test('pruneStaleSkips keeps a recent entry', () => {
  skipSignal('HEXA');
  pruneStaleSkips(14);
  expect(getSkippedSignals()).toEqual(['HEXA']);
});
