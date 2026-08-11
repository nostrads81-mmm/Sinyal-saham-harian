// Thin wrapper around the Google Sheets/Drive API v4 REST endpoints.
// Called directly from the browser using the user's own OAuth token -
// no backend involved for reading/writing sheets.

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

async function sheetsFetch(path, token, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function driveFetch(path, token, options = {}) {
  const res = await fetch(`${DRIVE_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getValues(spreadsheetId, range, token) {
  const data = await sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    token
  );
  return data.values || [];
}

export async function setValues(spreadsheetId, range, values, token) {
  return sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    token,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );
}

export async function appendValues(spreadsheetId, range, values, token) {
  return sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: 'POST', body: JSON.stringify({ values }) }
  );
}

export async function clearValues(spreadsheetId, range, token) {
  return sheetsFetch(
    `/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    token,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export const WATCHLIST_SHEET_ID = '1IGWmSd39AqD1JY5FkHop5g_C-hmeTD9yoRjuMhYsIqw';

// Deliberately wide/generous range: lib/scoring.js's locateWatchlistTable()
// scans this for the actual header row ("DATE"/"STOCK" cells) instead of
// assuming a fixed row number - the sheet owner adds new signal rows daily
// and the row offset has already shifted on us once. Column A is blank in
// the source sheet, so the range starts at B.
export const WATCHLIST_RANGE = 'B1:Q80';

// Before multi-account support, every user pointed at this one hardcoded
// spreadsheet. Whoever's Google account already has access to it keeps
// using that exact sheet - checked via the broad "spreadsheets" scope
// alone, no Drive access needed - so the original owner's journal history
// isn't orphaned in favor of a fresh empty sheet.
const LEGACY_APP_DATA_SHEET_ID = '1pTzg7K8i5fk9jE0KyBN956lIQhsAIOUF7q2DfadrWqA';

// Any OTHER Google account that signs in gets its OWN spreadsheet for
// Settings/DayTrade_Journal, auto-created on first use. Discovered by file
// name via the Drive API (requires the drive.file scope granted in
// lib/auth.js) so the same file is found again on a later visit, even from
// a different device.
const APP_DATA_FILE_NAME = 'Sinyal Saham Harian - Data';

export async function getOrCreateAppDataSheetId(token) {
  try {
    await getValues(LEGACY_APP_DATA_SHEET_ID, 'Settings!A1:A1', token);
    return LEGACY_APP_DATA_SHEET_ID;
  } catch {
    // Not accessible to this account - fall through to a personal sheet.
  }

  const query = `name='${APP_DATA_FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const found = await driveFetch(
    `/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`,
    token
  );
  if (found.files && found.files.length > 0) {
    return found.files[0].id;
  }
  const created = await sheetsFetch('', token, {
    method: 'POST',
    body: JSON.stringify({ properties: { title: APP_DATA_FILE_NAME } }),
  });
  return created.spreadsheetId;
}

const SHEET_HEADERS = {
  DayTrade_Journal: [
    'Tanggal Entry', 'Simbol', 'Entry', 'SL', 'TP1', 'TP2',
    'Status', 'Tanggal Exit', 'Harga Exit', 'Catatan',
  ],
  // Fee fields added 2026-08-03 (Stockbit: fee beli 0,15%, fee jual 0,25%,
  // materai Rp10.000 kalau nilai transaksi beli ATAU jual > Rp10jt).
  Settings: [
    'Modal Trading', 'Risiko per Trade (%)', 'Maks Posisi Bersamaan',
    'Biaya Beli (%)', 'Biaya Jual (%)', 'Materai (Rp)', 'Batas Materai (Rp)',
  ],
  // WA-sourced signals, so they're shared across every device signed into
  // this account instead of stuck in one browser's localStorage.
  WA_Signals: [
    'Stock', 'TradeType', 'BuyLow', 'BuyHigh', 'SL', 'TP1', 'TP2', 'MmPercent', 'CapturedAt',
  ],
};

const DEFAULT_SETTINGS_VALUES = [50000000, 0.005, 6, 0.0015, 0.0025, 10000, 10000000];

// The Sheets values API 400s with INVALID_ARGUMENT (not 404) when a range
// references a tab that doesn't exist at all in the spreadsheet - it's not
// enough to check for empty headers, the tab itself has to exist first.
// This matters whenever a new tab is added to SHEET_HEADERS after accounts
// already have a spreadsheet from before that tab existed (e.g. WA_Signals
// added on top of the original Settings/DayTrade_Journal-only sheets).
async function ensureTabsExist(token, sheetId, tabNames) {
  const meta = await sheetsFetch(`/${sheetId}?fields=sheets.properties.title`, token);
  const existingTitles = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = tabNames.filter((tab) => !existingTitles.has(tab));
  if (missing.length === 0) return;
  await sheetsFetch(`/${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
    }),
  });
}

// Writes header rows (and default Settings values) the first time a user's
// app data spreadsheet is used, so a freshly created blank sheet becomes
// usable. Also migrates an existing-but-older Settings row that predates
// the fee columns, by appending just the missing headers/defaults after
// whatever is already there (so the user's own Modal/Risiko/Slot values
// aren't touched).
export async function ensureSheetsInitialized(token, sheetId) {
  await ensureTabsExist(token, sheetId, Object.keys(SHEET_HEADERS));
  for (const [tab, headers] of Object.entries(SHEET_HEADERS)) {
    const existing = await getValues(sheetId, `${tab}!A1:Z1`, token);
    if (existing.length === 0 || existing[0].length === 0) {
      await setValues(sheetId, `${tab}!A1`, [headers], token);
      if (tab === 'Settings') {
        await setValues(sheetId, 'Settings!A2', [DEFAULT_SETTINGS_VALUES], token);
      }
    } else if (tab === 'Settings' && existing[0].length < headers.length) {
      const currentCount = existing[0].length;
      const startCol = String.fromCharCode(65 + currentCount);
      await setValues(sheetId, `Settings!${startCol}1`, [headers.slice(currentCount)], token);
      await setValues(sheetId, `Settings!${startCol}2`, [DEFAULT_SETTINGS_VALUES.slice(currentCount)], token);
    }
  }
}

export async function getSettings(token, sheetId) {
  const rows = await getValues(sheetId, 'Settings!A2:G2', token);
  const row = rows[0] || DEFAULT_SETTINGS_VALUES;
  const num = (i) => {
    const n = Number(row[i]);
    return Number.isFinite(n) && row[i] !== undefined && row[i] !== '' ? n : DEFAULT_SETTINGS_VALUES[i];
  };
  return {
    capital: num(0),
    riskPercent: num(1),
    maxSlots: num(2),
    buyFeePercent: num(3),
    sellFeePercent: num(4),
    materaiAmount: num(5),
    materaiThreshold: num(6),
  };
}

export async function updateSettings(token, sheetId, { capital, maxSlots }) {
  await setValues(sheetId, 'Settings!A2', [[capital]], token);
  await setValues(sheetId, 'Settings!C2', [[maxSlots]], token);
}

function parseLotFromCatatan(catatan) {
  const match = String(catatan || '').match(/Lot:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

// PENDING = order placed at the broker but not yet filled. The cash is
// already locked up there even though there's no live position yet, so it
// counts as "active" here too - same slot/capital treatment as RUNNING -
// otherwise the app would keep recommending new positions against money
// that's already spoken for.
const ACTIVE_STATUSES = ['RUNNING', 'PENDING', 'OPEN'];

async function getActiveJournalRows(token, sheetId) {
  const rows = await getValues(sheetId, 'DayTrade_Journal!A2:J500', token);
  return rows.filter((r) => ACTIVE_STATUSES.includes((r[6] || '').toUpperCase()));
}

export async function getActiveJournalCount(token, sheetId) {
  return (await getActiveJournalRows(token, sheetId)).length;
}

// Stocks with a currently-active journal entry (RUNNING/PENDING/OPEN) - kept
// out of the Sinyal recommendation list while that position is live, so the
// app doesn't suggest doubling up on something already bought. A CLOSED
// entry does NOT count: once a position is sold and off the active list, a
// fresh signal for that same stock is a new opportunity, not a duplicate,
// so it should be recommendable again right away.
export async function getJournaledStocks(token, sheetId) {
  const rows = await getActiveJournalRows(token, sheetId);
  return new Set(rows.map((r) => (r[1] || '').toUpperCase()).filter(Boolean));
}

// Total rupiah already committed to RUNNING/OPEN journal entries (entry price
// x lot x 100 shares/lot). Used to gate NEW recommendations by real remaining
// capital instead of a plain position count - a fixed slot count can either
// block recommendations while capital is still free, or let total exposure
// blow past the actual budget, since it has no idea how big each position is.
export async function getInvestedCapital(token, sheetId) {
  const rows = await getActiveJournalRows(token, sheetId);
  return rows.reduce((sum, r) => {
    const entry = Number(r[2]) || 0;
    const lot = parseLotFromCatatan(r[9]);
    return sum + entry * lot * 100;
  }, 0);
}

// rowNumber is the actual sheet row (2 = first data row, since row 1 is the header).
export async function getJournalEntries(token, sheetId) {
  const rows = await getValues(sheetId, 'DayTrade_Journal!A2:J500', token);
  return rows
    .map((r, i) => ({
      rowNumber: i + 2,
      tanggalEntry: r[0] || '',
      stock: r[1] || '',
      entry: Number(r[2]) || null,
      sl: Number(r[3]) || null,
      tp1: Number(r[4]) || null,
      tp2: r[5] ? Number(r[5]) : null,
      status: (r[6] || '').toUpperCase(),
      tanggalExit: r[7] || '',
      hargaExit: r[8] ? Number(r[8]) : null,
      catatan: r[9] || '',
    }))
    .filter((e) => e.stock);
}

export async function closeJournalEntry(token, sheetId, rowNumber, { tanggalExit, hargaExit, status }) {
  await setValues(
    sheetId,
    `DayTrade_Journal!H${rowNumber}:I${rowNumber}`,
    [[tanggalExit, hargaExit]],
    token
  );
  await setValues(sheetId, `DayTrade_Journal!G${rowNumber}`, [[status]], token);
}

// Order actually got filled at the broker - moves a PENDING row to RUNNING,
// updating the entry price/lot if the real fill differs from what was
// planned when the order was placed.
export async function confirmJournalFill(token, sheetId, rowNumber, { entry, lot }) {
  await setValues(sheetId, `DayTrade_Journal!C${rowNumber}`, [[entry]], token);
  await setValues(sheetId, `DayTrade_Journal!J${rowNumber}`, [[`Lot: ${lot}`]], token);
  await setValues(sheetId, `DayTrade_Journal!G${rowNumber}`, [['RUNNING']], token);
}

// Order never got filled (cancelled/expired at the broker) - the row is
// removed outright rather than kept as a status, since it never became a
// real trade and shouldn't linger in the history.
export async function deleteJournalRow(token, sheetId, rowNumber) {
  const meta = await sheetsFetch(`/${sheetId}?fields=sheets.properties`, token);
  const sheet = meta.sheets.find((s) => s.properties.title === 'DayTrade_Journal');
  await sheetsFetch(`/${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    }),
  });
}

// WA-sourced signals (see lib/scoring.js's buildWaSignal), kept in a sheet
// tab instead of localStorage so the same list shows up on every device
// signed into this account - not just the one where the screenshot was
// pasted.
const WA_SIGNALS_RANGE = 'WA_Signals!A2:I1000';

function waRowToSignal(r) {
  return {
    stock: r[0] || '',
    tradeType: r[1] === 'SWING TRADE' ? 'SWING TRADE' : 'DAY TRADE',
    buyLow: Number(r[2]) || 0,
    buyHigh: Number(r[3]) || 0,
    sl: Number(r[4]) || 0,
    tp1: Number(r[5]) || 0,
    tp2: r[6] ? Number(r[6]) : null,
    mmPercent: r[7] ? Number(r[7]) : null,
    capturedAt: r[8] || new Date().toISOString(),
  };
}

function signalToWaRow(s) {
  return [
    s.stock.toUpperCase(), s.tradeType || 'DAY TRADE', s.buyLow, s.buyHigh, s.sl, s.tp1,
    s.tp2 ?? '', s.mmPercent ?? '', s.capturedAt,
  ];
}

export async function getWaSignalRows(token, sheetId) {
  const rows = await getValues(sheetId, WA_SIGNALS_RANGE, token);
  return rows.filter((r) => r[0]).map(waRowToSignal);
}

async function writeWaSignalRows(token, sheetId, list) {
  await clearValues(sheetId, WA_SIGNALS_RANGE, token);
  if (list.length > 0) {
    await setValues(sheetId, 'WA_Signals!A2', list.map(signalToWaRow), token);
  }
}

export async function addWaSignalRow(token, sheetId, signal) {
  await addWaSignalRows(token, sheetId, [signal]);
}

// Adds several signals in one read-modify-write instead of one per signal -
// running addWaSignalRow in a loop would have each call read the sheet
// before an earlier call's write lands, silently dropping entries.
export async function addWaSignalRows(token, sheetId, signals) {
  let list = await getWaSignalRows(token, sheetId);
  for (const signal of signals) {
    list = list.filter((s) => s.stock.toUpperCase() !== signal.stock.toUpperCase());
    list.push(signal);
  }
  await writeWaSignalRows(token, sheetId, list);
}

export async function removeWaSignalRow(token, sheetId, stock) {
  const list = (await getWaSignalRows(token, sheetId))
    .filter((s) => s.stock.toUpperCase() !== stock.toUpperCase());
  await writeWaSignalRows(token, sheetId, list);
}

// Called after every fetch of the sheet-based signals: any WA signal whose
// stock now has a proper sheet entry is no longer needed.
export async function pruneStaleWaSignalRows(token, sheetId, staleStocks) {
  if (staleStocks.length === 0) return;
  const staleSet = new Set(staleStocks.map((s) => s.toUpperCase()));
  const list = (await getWaSignalRows(token, sheetId)).filter((s) => !staleSet.has(s.stock.toUpperCase()));
  await writeWaSignalRows(token, sheetId, list);
}
