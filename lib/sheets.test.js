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
      const headerCounts = { DayTrade_Journal: 12, Settings: 9, WA_Signals: 11 };
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

  test('writes Maks per Saham to Settings!J2, including 0 which means automatic', async () => {
    const calls = captureFetch();

    await updateSettings('token', 'sheet123', { capital: 350_000_000, maxSlots: 10, maxPerStock: 35_000_000 });
    await updateSettings('token', 'sheet123', { capital: 350_000_000, maxSlots: 10, maxPerStock: 0 });

    expect(calls.filter((c) => c.range === 'Settings!J2').map((c) => c.body.values))
      .toEqual([[[35_000_000]], [[0]]]);
  });

  test('reads maxPerStock from Settings!J2 and defaults to 0 (automatic)', async () => {
    captureFetch([['350000000', '0.005', '10', '', '', '', '', 'mid', 'mid', '35000000']]);
    expect((await getSettings('token', 'sheet123')).maxPerStock).toBe(35_000_000);

    captureFetch([['350000000', '0.005', '10', '', '', '', '', 'mid', 'mid', '']]);
    expect((await getSettings('token', 'sheet123')).maxPerStock).toBe(0);
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
describe('WA_Signals append-only writes', () => {
  const {
    addWaSignalRows, getWaSignalRows, removeWaSignalRow, pruneStaleWaSignalRows,
  } = require('./sheets');

  const sig = (stock, overrides = {}) => ({
    stock, tradeType: 'DAY TRADE', buyLow: 100, buyHigh: 110, sl: 95, tp1: 120,
    tp2: null, mmPercent: null, capturedAt: '2024-01-01T00:00:00.000Z', tag: null, ...overrides,
  });

  const tombstone = (stock) => [stock, '', '', '', '', '', '', '', '', '', '2026-09-21T00:00:00.000Z'];
  const liveRow = (stock) => [stock, 'DAY TRADE', 100, 110, 95, 120, '', '', '2024-01-01T00:00:00.000Z', '', ''];

  // In-memory WA_Signals tab behind a fake fetch, modelling the three write
  // shapes the code may use: :append (lands at the bottom), PUT at A2 (replaces
  // only the rows it covers) and :clear with a range (drops the tail).
  function installFakeWaSheet({ initialRows = [], onRewrite } = {}) {
    let rows = initialRows.map((r) => [...r]);
    const calls = [];
    const tick = () => new Promise((r) => setTimeout(r, 0));
    global.fetch = jest.fn((url, options = {}) => {
      const method = options.method || 'GET';
      const target = decodeURIComponent(String(url));
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ method, target, body });

      if (method === 'GET') {
        return tick().then(() => ({
          ok: true, status: 200, json: () => Promise.resolve({ values: rows.map((r) => [...r]) }),
        }));
      }
      if (method === 'POST' && target.includes(':append')) {
        const incoming = (body && body.values) || [];
        return tick().then(() => {
          const startRow = rows.length + 2;
          rows = [...rows, ...incoming.map((r) => [...r])];
          return {
            ok: true, status: 200,
            // The real API reports where the append landed; the code uses this
            // row number to decide whether the tab needs folding, with no read.
            json: () => Promise.resolve({
              updates: { updatedRange: `WA_Signals!A${startRow}:K${startRow + Math.max(incoming.length - 1, 0)}` },
            }),
          };
        });
      }
      if (method === 'PUT') {
        const incoming = (body && body.values) || [];
        return tick().then(() => {
          rows = [...incoming.map((r) => [...r]), ...rows.slice(incoming.length)];
          // Hook for simulating another device appending mid-rewrite.
          if (onRewrite) rows = [...rows, ...onRewrite()];
          return { ok: true, status: 200, json: () => Promise.resolve({}) };
        });
      }
      if (method === 'POST' && target.includes(':clear')) {
        const match = target.match(/!A(\d+):K\d+:clear$/);
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

  const reads = (sheet) => sheet.calls.filter((c) => c.method === 'GET');
  const rewrites = (sheet) => sheet.calls.filter((c) => c.method === 'PUT' || c.target.includes(':clear'));
  const appends = (sheet) => sheet.calls.filter((c) => c.target.includes(':append'));
  const stocks = (sheet) => sheet.getRows().map((r) => r[0]);
  test('adding a signal never reads the sheet first', async () => {
    // This is the whole point of the rework: with no read there is no snapshot
    // to go stale, so a signal another device saved a second ago cannot be
    // rewritten away by this one.
    const sheet = installFakeWaSheet();

    await addWaSignalRows('token', 'sheet123', [sig('AAA')]);

    expect(appends(sheet)).toHaveLength(1);
    expect(reads(sheet)).toHaveLength(0);
    expect(stocks(sheet)).toEqual(['AAA']);
  });

  test('two devices saving at the same time both survive', async () => {
    const sheet = installFakeWaSheet();

    await Promise.all([
      addWaSignalRows('token', 'sheet123', [sig('AAA')]),
      addWaSignalRows('token', 'sheet123', [sig('BBB')]),
    ]);

    expect(stocks(sheet).sort()).toEqual(['AAA', 'BBB']);
    expect(await getWaSignalRows('token', 'sheet123')).toHaveLength(2);
  });

  test('a deletion appends a tombstone and rewrites nothing', async () => {
    const sheet = installFakeWaSheet();
    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB')]);

    await removeWaSignalRow('token', 'sheet123', 'AAA');

    expect(rewrites(sheet)).toHaveLength(0);
    // The live row is still physically there - only the marker retires it.
    expect(stocks(sheet)).toEqual(['AAA', 'BBB', 'AAA']);
    expect(sheet.getRows()[2][10]).toBeTruthy();
    expect((await getWaSignalRows('token', 'sheet123')).map((s) => s.stock)).toEqual(['BBB']);
  });

  test('re-adding a stock after deleting it makes it live again', async () => {
    installFakeWaSheet();
    await addWaSignalRows('token', 'sheet123', [sig('AAA')]);
    await removeWaSignalRow('token', 'sheet123', 'AAA');

    await addWaSignalRows('token', 'sheet123', [sig('AAA', { buyLow: 105, buyHigh: 115 })]);
    const rows = await getWaSignalRows('token', 'sheet123');

    expect(rows).toHaveLength(1);
    expect(rows[0].buyLow).toBe(105);
  });

  test('the newest row for a stock wins, so editing the entry price sticks', async () => {
    installFakeWaSheet();
    await addWaSignalRows('token', 'sheet123', [sig('AAA', { buyLow: 100, buyHigh: 110 })]);
    await addWaSignalRows('token', 'sheet123', [sig('AAA', { buyLow: 130, buyHigh: 140 })]);

    const rows = await getWaSignalRows('token', 'sheet123');

    expect(rows).toHaveLength(1);
    expect(rows[0].buyLow).toBe(130);
    expect(rows[0].buyHigh).toBe(140);
  });

  test("one stock's tombstone does not hide another", async () => {
    installFakeWaSheet();
    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB'), sig('CCC')]);

    await removeWaSignalRow('token', 'sheet123', 'BBB');

    expect((await getWaSignalRows('token', 'sheet123')).map((s) => s.stock)).toEqual(['AAA', 'CCC']);
  });

  test('pruning the stocks the sheet took over appends tombstones only', async () => {
    const sheet = installFakeWaSheet();
    await addWaSignalRows('token', 'sheet123', [sig('AAA'), sig('BBB')]);

    await pruneStaleWaSignalRows('token', 'sheet123', ['aaa']);

    expect(rewrites(sheet)).toHaveLength(0);
    expect((await getWaSignalRows('token', 'sheet123')).map((s) => s.stock)).toEqual(['BBB']);
  });

  test('pruning with nothing stale never touches the sheet', async () => {
    const sheet = installFakeWaSheet({ initialRows: [liveRow('AAA')] });

    await pruneStaleWaSignalRows('token', 'sheet123', []);

    expect(sheet.calls).toEqual([]);
    expect(stocks(sheet)).toEqual(['AAA']);
  });

  test('the tab is folded back down once appends pile up past the threshold', async () => {
    // 205 rows is over the threshold, so the next append triggers the fold.
    const sheet = installFakeWaSheet({
      initialRows: [...Array(205)].map((_, i) => tombstone(`OLD${i}`)),
    });

    await addWaSignalRows('token', 'sheet123', [sig('NEW')]);

    expect(rewrites(sheet).length).toBeGreaterThan(0);
    expect(stocks(sheet)).toEqual(['NEW']);
    expect((await getWaSignalRows('token', 'sheet123')).map((s) => s.stock)).toEqual(['NEW']);
  });

  test('the fold keeps one row per live stock, dropping only the dead ones', async () => {
    const sheet = installFakeWaSheet({
      initialRows: [
        ...[...Array(205)].map((_, i) => tombstone(`OLD${i}`)),
        liveRow('AAA'),
        tombstone('AAA'),
        liveRow('BBB'),
      ],
    });

    await addWaSignalRows('token', 'sheet123', [sig('CCC')]);

    expect(stocks(sheet)).toEqual(['BBB', 'CCC']);
  });

  test('the fold leaves alone rows another device appends while it rewrites', async () => {
    const sheet = installFakeWaSheet({
      initialRows: [...Array(205)].map((_, i) => tombstone(`OLD${i}`)),
      // Simulates another device's append landing between the fold's read and
      // its clear: those rows sit below ours, so clearing the tail would delete
      // a signal this session never saw.
      onRewrite: () => [liveRow('OTHER')],
    });

    await addWaSignalRows('token', 'sheet123', [sig('NEW')]);

    expect(sheet.calls.some((c) => c.target.includes(':clear'))).toBe(false);
    expect(stocks(sheet)).toContain('OTHER');
  });
});

describe('WA_Signals schema migration', () => {
  const { ensureSheetsInitialized, getWaSignalRows } = require('./sheets');

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('an older sheet without DeletedAt gets just that header appended', async () => {
    const sheetId = `sheet-migrate-${Math.random()}`;
    const writes = [];
    global.fetch = jest.fn((url, options = {}) => {
      const target = decodeURIComponent(String(url));
      const method = options.method || 'GET';
      if (method === 'GET' && target.includes('fields=sheets.properties.title')) {
        const titles = ['DayTrade_Journal', 'Settings', 'WA_Signals'];
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ sheets: titles.map((title) => ({ properties: { title } })) }),
        });
      }
      if (method === 'GET' && target.includes('!A1:Z1')) {
        const tab = ['DayTrade_Journal', 'Settings', 'WA_Signals'].find((t) => target.includes(t));
        // WA_Signals at 10 columns = the shape every existing account still has,
        // written before the deletion marker existed.
        const counts = { DayTrade_Journal: 12, Settings: 10, WA_Signals: 10 };
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ values: [Array(counts[tab]).fill('x')] }),
        });
      }
      if (method === 'PUT') {
        writes.push({ target, values: JSON.parse(options.body).values });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ values: [] }) });
    });

    await ensureSheetsInitialized('token', sheetId);

    // Only the missing column is written, and only its header - the ten columns
    // of real data above it are never touched.
    expect(writes).toHaveLength(1);
    expect(writes[0].target).toContain('WA_Signals!K1');
    expect(writes[0].values).toEqual([['DeletedAt']]);
  });

  test('a row written before the marker column existed still counts as live', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({
        values: [['AAA', 'DAY TRADE', 100, 110, 95, 120, '', '', '2024-01-01T00:00:00.000Z', 'koko_saham']],
      }),
    }));

    const rows = await getWaSignalRows('token', 'sheet123');

    expect(rows.map((s) => s.stock)).toEqual(['AAA']);
    expect(rows[0].tag).toBe('koko_saham');
  });
});
