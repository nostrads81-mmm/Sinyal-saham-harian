jest.mock('./auth', () => ({
  refreshAccessToken: jest.fn(),
}));

const { refreshAccessToken } = require('./auth');
const {
  getValues, getActiveJournalSummary, getOrCreateAppDataSheetId, ensureSheetsInitialized,
  getSettings, updateSettings,
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

describe('getSettings / updateSettings', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // Every Settings read/write goes through the same values endpoint, so a
  // single fake that records url+method+body of each call is enough to prove
  // which cells actually got written.
  function captureFetch(values = []) {
    const calls = [];
    global.fetch = jest.fn((url, options = {}) => {
      calls.push({
        url: String(url),
        method: options.method || 'GET',
        range: decodeURIComponent(String(url).split('/values/')[1]?.split('?')[0] || ''),
        body: options.body ? JSON.parse(options.body) : null,
      });
      return Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve({ values }),
      });
    });
    return calls;
  }

  test('reads riskPercent/entryMode/tpMode from Settings row 2', async () => {
    captureFetch([['50000000', '0.0075', '6', '0.0015', '0.0025', '10000', '10000000', 'low', 'separate']]);

    const settings = await getSettings('token', 'sheet123');

    expect(settings.riskPercent).toBeCloseTo(0.0075);
    expect(settings.entryMode).toBe('low');
    expect(settings.tpMode).toBe('separate');
  });

  test('falls back to the default risk/modes when those cells are blank or unknown', async () => {
    captureFetch([['50000000', '', '6', '', '', '', '', 'aneh', '']]);

    const settings = await getSettings('token', 'sheet123');

    expect(settings.riskPercent).toBe(0.005);
    expect(settings.entryMode).toBe('mid');
    expect(settings.tpMode).toBe('mid');
  });

  test('writes riskPercent to Settings!B2 only when it is provided', async () => {
    const calls = captureFetch();

    await updateSettings('token', 'sheet123', { capital: 50000000, riskPercent: 0.0075, maxSlots: 6 });

    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.range, c.body.values])).toEqual([
      ['Settings!A2', [[50000000]]],
      ['Settings!B2', [[0.0075]]],
      ['Settings!C2', [[6]]],
    ]);

    calls.length = 0;
    await updateSettings('token', 'sheet123', { capital: 50000000, maxSlots: 6 });

    expect(calls.some((c) => c.range === 'Settings!B2')).toBe(false);
  });

  test('writes basis entry & tampilan TP to H2/I2 alongside the other fields', async () => {
    const calls = captureFetch();

    await updateSettings('token', 'sheet123', {
      capital: 50000000, riskPercent: 0.005, maxSlots: 6, entryMode: 'high', tpMode: 'separate',
    });

    expect(calls.filter((c) => ['Settings!H2', 'Settings!I2'].includes(c.range)).map((c) => [c.range, c.body.values]))
      .toEqual([
        ['Settings!H2', [['high']]],
        ['Settings!I2', [['separate']]],
      ]);
  });
});

// WA_Signals is a whole-tab replace (write fresh rows, then clear the tail),
// so every mutation is a read-modify-write. Without the per-sheetId
// serialization queue, two overlapping mutations each snapshot the sheet before
// the other's write lands, and the later write silently drops the earlier one.
//
// Note the limit: this only orders mutations inside THIS browser session. Two
// devices signed into the same account can still interleave - fixing that
// needs a server-side write or a Sheets-side script, not a client queue.
describe('WA_Signals mutation serialization', () => {
  const { addWaSignalRows, removeWaSignalRow, pruneStaleWaSignalRows } = require('./sheets');

  const sig = (stock) => ({
    stock, tradeType: 'DAY TRADE', buyLow: 100, buyHigh: 110, sl: 95, tp1: 120,
    tp2: null, mmPercent: null, capturedAt: '2024-01-01T00:00:00.000Z', tag: null,
  });

  // In-memory WA_Signals "sheet" backed by a fake fetch. Reads return whatever
  // is currently stored; writes replace it. A small async tick on every call
  // makes interleaving possible if operations are NOT serialized.
  function installFakeWaSheet(initialRows = []) {
    let rows = initialRows.map((r) => [...r]);
    const calls = [];
    global.fetch = jest.fn((url, options) => {
      const method = options.method || 'GET';
      const target = decodeURIComponent(String(url));
      calls.push({ method, target, body: options.body ? JSON.parse(options.body) : null });
      const tick = () => new Promise((r) => setTimeout(r, 0));
      if (target.includes('values') && method === 'GET') {
        return tick().then(() => ({ ok: true, status: 200, json: () => Promise.resolve({ values: rows.map((r) => [...r]) }) }));
      }
      if (method === 'PUT') {
        const body = options.body ? JSON.parse(options.body) : {};
        return tick().then(() => {
          // Write starting at A2. Real Sheets semantics: only the rows the
          // write covers are replaced - anything below survives until it is
          // explicitly cleared, which is what the tail-clear call is for.
          const incoming = body.values || [];
          rows = [...incoming.map((r) => [...r]), ...rows.slice(incoming.length)];
          return { ok: true, status: 200, json: () => Promise.resolve({}) };
        });
      }
      if (method === 'POST' && target.includes(':clear')) {
        // "WA_Signals!A5:J1000:clear" -> keep rows above A5 (index < 5 - 2).
        const match = target.match(/!A(\d+):J\d+:clear$/);
        const keep = match ? Number(match[1]) - 2 : 0;
        return tick().then(() => {
          rows = rows.slice(0, Math.max(keep, 0));
          return { ok: true, status: 200, json: () => Promise.resolve({}) };
        });
      }
      return tick().then(() => ({ ok: true, status: 200, json: () => Promise.resolve({}) }));
    });
    return { getRows: () => rows, calls };
  }

  test('two concurrent signal additions do not lose either one', async () => {
    const sheet = installFakeWaSheet();

    await Promise.all([
      addWaSignalRows('token', 'sheet123', [sig('AAA')]),
      addWaSignalRows('token', 'sheet123', [sig('BBB')]),
    ]);

    const stocks = sheet.getRows().map((r) => r[0]).sort();
    expect(stocks).toEqual(['AAA', 'BBB']);
  });

  // Range of each write/clear call, i.e. "WA_Signals!A2" - query string and the
  // trailing :clear action stripped off.
  const rangeOf = (call) => call.target.split('/values/')[1].split('?')[0].replace(/:clear$/, '');
  const mutations = (sheet) => sheet.calls
    .filter((c) => c.method === 'PUT' || c.method === 'POST')
    .map((c) => `${c.method} ${rangeOf(c)}`);

  test('writes the fresh rows before clearing the tail, so the sheet is never left empty', async () => {
    const sheet = installFakeWaSheet([
      ['OLD1', 'DAY TRADE', 100, 110, 95, 120, '', '', '2024-01-01T00:00:00.000Z', ''],
    ]);

    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB')]);

    // Adding merges with what's already there (OLD1 stays), so the list being
    // saved is 3 rows and the tail starts at A5. What this test pins is the
    // ORDER: the write lands first, the clear second. The old
    // clear-then-write order wiped the sheet empty before the new rows
    // arrived, so an interrupted save could lose the whole list.
    expect(mutations(sheet)).toEqual(['PUT WA_Signals!A2', 'POST WA_Signals!A5:J1000']);
    expect(sheet.getRows().map((r) => r[0])).toEqual(['OLD1', 'AAA', 'BBB']);
  });

  test('a shrinking list clears only the rows that are no longer covered', async () => {
    const sheet = installFakeWaSheet();

    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB'), sig('CCC')]);
    sheet.calls.length = 0;
    await removeWaSignalRow('token', 'sheet123', 'BBB');

    expect(sheet.getRows().map((r) => r[0])).toEqual(['AAA', 'CCC']);
    expect(mutations(sheet)).toEqual(['PUT WA_Signals!A2', 'POST WA_Signals!A4:J1000']);
  });

  test('one failed mutation does not block the next one', async () => {
    const sheet = installFakeWaSheet();
    const sheetFetch = global.fetch;
    let failNextWrite = true;
    global.fetch = jest.fn((url, options = {}) => {
      if (failNextWrite && options.method === 'PUT') {
        failNextWrite = false;
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
      }
      return sheetFetch(url, options);
    });

    await expect(addWaSignalRows('token', 'sheet123', [sig('AAA')]))
      .rejects.toThrow('Sheets API error 500');
    await addWaSignalRows('token', 'sheet123', [sig('BBB')]);

    expect(sheet.getRows().map((r) => r[0])).toEqual(['BBB']);
  });

  // The queue key is the sheetId - a mutation stuck on one spreadsheet must not
  // hold up a mutation on another. If the lock were global this test would
  // never get past the second await.
  test('mutations on different sheetIds do not wait on each other', async () => {
    const sheet = installFakeWaSheet();
    const sheetFetch = global.fetch;
    let releaseSlowSheet;
    const slowSheetGate = new Promise((resolve) => { releaseSlowSheet = resolve; });
    global.fetch = jest.fn((url, options = {}) => (
      String(url).includes('sheetSlow') ? slowSheetGate.then(() => sheetFetch(url, options)) : sheetFetch(url, options)
    ));

    const slow = addWaSignalRows('token', 'sheetSlow', [sig('SLOW')]);
    await addWaSignalRows('token', 'sheetFast', [sig('FAST')]);
    expect(sheet.getRows().map((r) => r[0])).toEqual(['FAST']);

    releaseSlowSheet();
    await slow;
    expect(sheet.getRows().map((r) => r[0])).toEqual(['FAST', 'SLOW']);
  });

  test('pruning with nothing stale never touches the sheet', async () => {
    const sheet = installFakeWaSheet([
      ['AAA', 'DAY TRADE', 100, 110, 95, 120, '', '', '2024-01-01T00:00:00.000Z', ''],
    ]);

    await pruneStaleWaSignalRows('token', 'sheet123', []);

    expect(sheet.calls).toEqual([]);
    expect(sheet.getRows().map((r) => r[0])).toEqual(['AAA']);
  });

  test('pruning stale stocks removes just those rows', async () => {
    const sheet = installFakeWaSheet();

    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB')]);
    await pruneStaleWaSignalRows('token', 'sheet123', ['aaa']);

    expect(sheet.getRows().map((r) => r[0])).toEqual(['BBB']);
  });
});
