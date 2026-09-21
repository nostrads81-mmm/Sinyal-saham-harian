const { safeSetItem, safeGetItem, safeRemoveItem } = require('./storage');

describe('safeSetItem / safeRemoveItem', () => {
  afterEach(() => {
    delete global.localStorage;
  });

  test('writes and removes normally when storage works', () => {
    const store = new Map();
    global.window = global.window || {};
    global.localStorage = {
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };

    expect(safeSetItem('k', 'v')).toBe(true);
    expect(store.get('k')).toBe('v');
    expect(safeRemoveItem('k')).toBe(true);
    expect(store.has('k')).toBe(false);
  });

  test('swallows the error when the browser refuses to write', () => {
    // This is what private mode / a full quota looks like: setItem throws.
    global.window = global.window || {};
    global.localStorage = {
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('QuotaExceededError'); },
    };

    expect(() => safeSetItem('k', 'v')).not.toThrow();
    expect(safeSetItem('k', 'v')).toBe(false);
    expect(() => safeRemoveItem('k')).not.toThrow();
    expect(safeRemoveItem('k')).toBe(false);
  });

  test('does nothing on the server, where there is no storage', () => {
    delete global.window;
    delete global.localStorage;

    expect(safeSetItem('k', 'v')).toBe(false);
    expect(safeRemoveItem('k')).toBe(false);
    expect(safeGetItem('k')).toBeNull();
  });

  test('a read that throws is treated as "no preference", not a crash', () => {
    global.window = global.window || {};
    global.localStorage = {
      getItem: () => { throw new Error('SecurityError'); },
    };

    expect(() => safeGetItem('ssh_theme')).not.toThrow();
    expect(safeGetItem('ssh_theme')).toBeNull();
  });
});