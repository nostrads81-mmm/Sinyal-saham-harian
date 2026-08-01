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

// Real sheet row numbers run 2 lower than what the visual/markdown export
// suggested (confirmed via debug logging: B7 was actually returning the
// OASA row, not ESIP) - likely frozen/hidden rows at the top skew the count.
// Column A is blank in the source sheet, so the range starts at B to keep
// row[0] = DATE and match the column indices in lib/scoring.js.
export const WATCHLIST_RANGE = 'B5:Q38';

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
