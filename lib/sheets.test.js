jest.mock('./auth', () => ({
  refreshAccessToken: jest.fn(),
}));

const { refreshAccessToken } = require('./auth');
const {
  getValues, getActiveJournalSummary, getOrCreateAppDataSheetId, ensureSheetsInitialized,
} = require('./sheets');

// Minimal localStorage stand-in - the sheetId cache and ensureSheetsInitialized
// tests need `typeof window !== 'undefined'` to be true, which the node test
// environment doesn't provide on its own.
function installFakeLocalStorage() {
  const store = new Map();
  global.window = global.window || {};
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

describe('sheetsFetch auth retry', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('retries once with a fresh token when the API rejects the cached one with 401', async () => {
    const calls = [];
    global.fetch = jest.fn((url, options) => {
      const bearer = options.headers.Authorization;
      calls.push(bearer);
      if (bearer === 'Bearer stale-token') {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{"error":"expired"}') });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ values: [['A1']] }) });
    });
    refreshAccessToken.mockResolvedValue('fresh-token');

    const values = await getValues('sheet123', 'A1:B2', 'stale-token');

    expect(values).toEqual([['A1']]);
    expect(calls).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  test('does not retry when the request succeeds on the first try', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ values: [] }),
    }));
    refreshAccessToken.mockResolvedValue('unused');

    await getValues('sheet123', 'A1:B2', 'good-token');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  test('still throws when the retry with a fresh token also fails', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false, status: 401, text: () => Promise.resolve('{"error":"still invalid"}'),
    }));
    refreshAccessToken.mockResolvedValue('fresh-token');

    await expect(getValues('sheet123', 'A1:B2', 'stale-token')).rejects.toThrow('Sheets API error 401');
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe('getActiveJournalSummary', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('derives count/journaledStocks/investedCapital from a single fetch', async () => {
    const rows = [
      ['19-08-2026', 'BBCA', '9000', '8800', '9300', '9500', 'RUNNING', '', '', 'Lot: 10', 'DAY TRADE'],
      ['18-08-2026', 'TLKM', '3000', '2900', '3200', '', 'CLOSED', '20-08-2026', '3200', 'Lot: 5', 'DAY TRADE'],
      ['17-08-2026', 'ASII', '5000', '4800', '5300', '', 'PENDING', '', '', 'Lot: 2', 'SWING TRADE'],
    ];
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ values: rows }),
    }));

    const summary = await getActiveJournalSummary('sheet123', 'token');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(summary.activeCount).toBe(2);
    expect(summary.journaledStocks).toEqual(new Set(['BBCA', 'ASII']));
    expect(summary.investedCapital).toBe(9000 * 1000 + 5000 * 200);
  });
});

describe('getOrCreateAppDataSheetId caching', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    installFakeLocalStorage();
    localStorage.removeItem('app_data_sheet_id');
  });

  test('resolves over the network once, then serves the cached ID with no network calls', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ values: [['x']] }),
    }));

    const first = await getOrCreateAppDataSheetId('token');
    expect(first).toBeTruthy();
    expect(global.fetch).toHaveBeenCalled();

    global.fetch.mockClear();
    const second = await getOrCreateAppDataSheetId('token');

    expect(second).toBe(first);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('ensureSheetsInitialized', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('skips re-checking a sheetId it already verified this session', async () => {
    const sheetId = `sheet-${Math.random()}`;
    global.fetch = jest.fn((url) => {
      if (String(url).includes('fields=sheets.properties.title')) {
        const titles = ['DayTrade_Journal', 'Settings', 'WA_Signals'];
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ sheets: titles.map((title) => ({ properties: { title } })) }),
        });
      }
      // Every tab already has its full header row - no migration branch hit.
      const headerCounts = { DayTrade_Journal: 11, Settings: 9, WA_Signals: 9 };
      const tab = Object.keys(headerCounts).find((t) => String(url).includes(t));
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ values: [Array(headerCounts[tab] || 1).fill('x')] }),
      });
    });

    await ensureSheetsInitialized('token', sheetId);
    const firstCallCount = global.fetch.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    global.fetch.mockClear();
    await ensureSheetsInitialized('token', sheetId);

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
