// Thin wrapper around the Google Sheets API v4 REST endpoints.
// Called directly from the browser using the user's own OAuth token -
// no backend involved for reading/writing sheets.

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

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

export const WATCHLIST_SHEET_ID = '1IGWmSd39AqD1JY5FkHop5g_C-hmeTD9yoRjuMhYsIqw';
export const APP_DATA_SHEET_ID = '1pTzg7K8i5fk9jE0KyBN956lIQhsAIOUF7q2DfadrWqA';

// Deliberately wide/generous range: lib/scoring.js's locateWatchlistTable()
// scans this for the actual header row ("DATE"/"STOCK" cells) instead of
// assuming a fixed row number - the sheet owner adds new signal rows daily
// and the row offset has already shifted on us once. Column A is blank in
// the source sheet, so the range starts at B.
export const WATCHLIST_RANGE = 'B1:Q80';

const SHEET_HEADERS = {
  Portfolio_Latest: ['Simbol', 'Avg Price', 'Qty (lot)', 'Harga Sekarang', 'Tanggal Update'],
  Portfolio_History: ['Tanggal', 'Simbol', 'Avg Price', 'Qty (lot)', 'Harga', 'Total Ekuitas'],
  DayTrade_Journal: [
    'Tanggal Entry', 'Simbol', 'Entry', 'SL', 'TP1', 'TP2',
    'Status', 'Tanggal Exit', 'Harga Exit', 'Catatan',
  ],
  Settings: ['Modal Trading', 'Risiko per Trade (%)', 'Maks Posisi Bersamaan'],
};

const DEFAULT_SETTINGS_VALUES = [50000000, 0.005, 6];

// Writes header rows (and default Settings values) the first time the app
// data spreadsheet is used, so a freshly created blank sheet becomes usable.
export async function ensureSheetsInitialized(token) {
  for (const [tab, headers] of Object.entries(SHEET_HEADERS)) {
    const existing = await getValues(APP_DATA_SHEET_ID, `${tab}!A1:Z1`, token);
    if (existing.length === 0 || existing[0].length === 0) {
      await setValues(APP_DATA_SHEET_ID, `${tab}!A1`, [headers], token);
      if (tab === 'Settings') {
        await setValues(APP_DATA_SHEET_ID, 'Settings!A2', [DEFAULT_SETTINGS_VALUES], token);
      }
    }
  }
}

export async function getSettings(token) {
  const rows = await getValues(APP_DATA_SHEET_ID, 'Settings!A2:C2', token);
  const row = rows[0] || DEFAULT_SETTINGS_VALUES;
  return {
    capital: Number(row[0]) || DEFAULT_SETTINGS_VALUES[0],
    riskPercent: Number(row[1]) || DEFAULT_SETTINGS_VALUES[1],
    maxSlots: Number(row[2]) || DEFAULT_SETTINGS_VALUES[2],
  };
}

export async function getActiveJournalCount(token) {
  const rows = await getValues(APP_DATA_SHEET_ID, 'DayTrade_Journal!A2:J500', token);
  return rows.filter((r) => ['RUNNING', 'OPEN'].includes((r[6] || '').toUpperCase())).length;
}

// Stocks that already have an open journal entry - used to disable the
// "sudah beli" button so the same trade doesn't get logged twice.
export async function getJournaledStocks(token) {
  const rows = await getValues(APP_DATA_SHEET_ID, 'DayTrade_Journal!A2:J500', token);
  const stocks = rows
    .filter((r) => ['RUNNING', 'OPEN'].includes((r[6] || '').toUpperCase()))
    .map((r) => (r[1] || '').toUpperCase());
  return new Set(stocks);
}

// rowNumber is the actual sheet row (2 = first data row, since row 1 is the header).
export async function getJournalEntries(token) {
  const rows = await getValues(APP_DATA_SHEET_ID, 'DayTrade_Journal!A2:J500', token);
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

export async function closeJournalEntry(token, rowNumber, { tanggalExit, hargaExit, status }) {
  await setValues(
    APP_DATA_SHEET_ID,
    `DayTrade_Journal!H${rowNumber}:I${rowNumber}`,
    [[tanggalExit, hargaExit]],
    token
  );
  await setValues(APP_DATA_SHEET_ID, `DayTrade_Journal!G${rowNumber}`, [[status]], token);
}

export async function clearValues(spreadsheetId, range, token) {
  return sheetsFetch(`/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, token, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getPortfolioLatest(token) {
  const rows = await getValues(APP_DATA_SHEET_ID, 'Portfolio_Latest!A2:E50', token);
  return rows
    .map((r) => ({
      symbol: r[0] || '',
      avgPrice: Number(r[1]) || null,
      qtyLot: Number(r[2]) || null,
      currentPrice: Number(r[3]) || null,
      updatedAt: r[4] || '',
    }))
    .filter((h) => h.symbol);
}

// Overwrites the whole Portfolio_Latest table (yesterday's holdings may no
// longer match today's screenshot) and appends one snapshot row per holding
// to Portfolio_History so the equity trend can be charted later.
export async function savePortfolio(token, holdings, todayLabel) {
  await clearValues(APP_DATA_SHEET_ID, 'Portfolio_Latest!A2:E50', token);
  if (holdings.length > 0) {
    const latestRows = holdings.map((h) => [h.symbol, h.avgPrice, h.qtyLot, h.currentPrice, todayLabel]);
    await setValues(APP_DATA_SHEET_ID, 'Portfolio_Latest!A2', latestRows, token);

    const totalEquity = holdings.reduce((sum, h) => sum + h.currentPrice * h.qtyLot * 100, 0);
    const historyRows = holdings.map((h) => [
      todayLabel, h.symbol, h.avgPrice, h.qtyLot, h.currentPrice, totalEquity,
    ]);
    await appendValues(APP_DATA_SHEET_ID, 'Portfolio_History!A:F', historyRows, token);
  }
}
