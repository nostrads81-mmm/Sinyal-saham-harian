// Parsing & ranking logic for the DAY TRADE watchlist sheet.
// Pure functions, no AI involved - deterministic rules only.

function parseIndoNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

// "118 (-6.35%)" -> { price: 118, percent: -6.35 }
function parsePriceWithPercent(raw) {
  if (!raw || raw === '-') return { price: null, percent: null };
  const match = String(raw).match(/^([\d.,]+)\s*\(([-\d.,]+)%\)/);
  if (!match) return { price: parseIndoNumber(raw), percent: null };
  return { price: parseIndoNumber(match[1]), percent: parseFloat(match[2].replace(',', '.')) };
}

// "119-126" -> { low: 119, high: 126 }
function parseRange(raw) {
  if (!raw) return { low: null, high: null };
  const parts = String(raw).split('-').map((p) => p.trim());
  if (parts.length !== 2) {
    const single = parseIndoNumber(raw);
    return { low: single, high: single };
  }
  return { low: parseIndoNumber(parts[0]), high: parseIndoNumber(parts[1]) };
}

function parseSheetDate(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function daysBetween(from, to) {
  if (!from) return null;
  const ms = to.setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Column names as they appear in the sheet's own header row (case-insensitive,
// whitespace-trimmed). We look these up by NAME instead of hardcoding a fixed
// position, so the parser survives the sheet owner reordering/inserting
// columns. We only break if they rename a header outright.
const HEADER_ALIASES = {
  DATE: ['DATE'],
  STOCK: ['STOCK'],
  BUY_PRICE: ['BUY PRICE'],
  LAST_PRICE: ['LAST PRICE'],
  SL: ['SL'],
  TP1: ['TP 1', 'TP1'],
  TP2: ['TP 2', 'TP2'],
  STATUS: ['STATUS'],
  DETAIL_STATUS: ['DETAIL STATUS'],
  MM_PERCENT: ['MM (%MODAL)', 'MM%', 'MM (%MODAL'],
  KETERANGAN: ['KETERANGAN'],
};

// Scans a wide raw grid (starting at column B, any number of leading rows)
// for the header row - the row that contains both "DATE" and "STOCK" cells -
// then builds a { fieldName: columnIndex } map from HEADER_ALIASES and
// returns the data rows found below it. Throws a descriptive error if the
// sheet's structure has changed enough that we can't find our bearings.
export function locateWatchlistTable(grid) {
  const normalize = (v) => String(v || '').trim().toUpperCase();

  const headerRowIndex = grid.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.includes('DATE') && cells.includes('STOCK');
  });

  if (headerRowIndex === -1) {
    throw new Error(
      'Tidak ketemu baris header watchlist (kolom "DATE" & "STOCK"). ' +
      'Kemungkinan struktur sheet sumber sudah berubah - perlu dicek manual.'
    );
  }

  const headerRow = grid[headerRowIndex].map(normalize);
  const columnMap = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headerRow.findIndex((cell) => aliases.includes(cell));
    if (idx === -1) {
      throw new Error(`Kolom "${aliases[0]}" tidak ditemukan di header watchlist - cek struktur sheet.`);
    }
    columnMap[field] = idx;
  }

  return { columnMap, dataRows: grid.slice(headerRowIndex + 1) };
}

export function parseWatchlistRows(rows, { tradeType = 'DAY TRADE', now = new Date() } = {}) {
  const { columnMap: COL, dataRows } = locateWatchlistTable(rows);
  const parsed = [];
  for (const row of dataRows) {
    const keterangan = (row[COL.KETERANGAN] || '').trim().toUpperCase();
    if (tradeType && keterangan !== tradeType) continue;

    const stock = (row[COL.STOCK] || '').trim();
    if (!stock) continue;

    const dateRaw = row[COL.DATE];
    const date = parseSheetDate(dateRaw);
    const buyRange = parseRange(row[COL.BUY_PRICE]);
    const lastPrice = parseIndoNumber(row[COL.LAST_PRICE]);
    const sl = parsePriceWithPercent(row[COL.SL]);
    const tp1 = parsePriceWithPercent(row[COL.TP1]);
    const tp2 = parsePriceWithPercent(row[COL.TP2]);
    const status = (row[COL.STATUS] || '').trim().toUpperCase();
    const detailStatus = (row[COL.DETAIL_STATUS] || '').trim();
    const mmPercent = parseIndoNumber(row[COL.MM_PERCENT]);
    const ageDays = daysBetween(date, new Date(now));

    if (sl.price === null || tp1.price === null || buyRange.high === null) continue;

    // Single entry point rule: last price above range -> use upper bound (breakout);
    // inside range -> use last price; below range -> wait, flag it.
    let entry;
    let waitFor = null;
    if (lastPrice !== null && lastPrice > buyRange.high) {
      entry = buyRange.high;
    } else if (lastPrice !== null && lastPrice >= buyRange.low) {
      entry = lastPrice;
    } else {
      entry = buyRange.low;
      waitFor = buyRange.low;
    }

    const slPercent = Math.abs((entry - sl.price) / entry) * 100;
    const tp1Percent = Math.abs((tp1.price - entry) / entry) * 100;
    const score = slPercent > 0 ? tp1Percent / slPercent : 0;

    const isOpen = status.startsWith('OPEN');
    // Scope (2026-08-01): app only surfaces fresh OPEN signals now - already
    // RUNNING signals (even ones marked NEW) are dropped entirely, not shown.
    const isFreshRunning = false;

    parsed.push({
      stock,
      date,
      ageDays,
      entry,
      waitFor,
      sl: sl.price,
      slPercent,
      tp1: tp1.price,
      tp1Percent,
      tp2: tp2.price,
      status,
      detailStatus,
      mmPercent,
      score,
      isOpen,
      isFreshRunning,
      isActionable: isOpen || isFreshRunning,
      source: 'sheet',
    });
  }
  return parsed;
}

// Turns a WA-announcement extraction (see lib/waSignals.js) into the same
// signal shape as parseWatchlistRows(), so both sources can be ranked
// together. WA posts have no live LAST PRICE, so entry defaults to the
// midpoint of the buy range - flagged via `estimatedEntry` for the UI.
export function buildWaSignal({ stock, buyLow, buyHigh, sl, tp1, tp2, mmPercent, capturedAt }) {
  const entry = (buyLow + buyHigh) / 2;
  const slPercent = Math.abs((entry - sl) / entry) * 100;
  const tp1Percent = Math.abs((tp1 - entry) / entry) * 100;
  const score = slPercent > 0 ? tp1Percent / slPercent : 0;

  return {
    stock: stock.trim().toUpperCase(),
    date: capturedAt ? new Date(capturedAt) : new Date(),
    ageDays: 0,
    entry,
    estimatedEntry: true,
    waitFor: null,
    sl,
    slPercent,
    tp1,
    tp1Percent,
    tp2: tp2 || null,
    status: 'OPEN (WA)',
    detailStatus: '',
    mmPercent: mmPercent || null,
    score,
    isOpen: true,
    isFreshRunning: false,
    isActionable: true,
    source: 'wa',
  };
}

// Drops any WA-sourced signal whose stock already has a sheet-sourced entry -
// the sheet is the more authoritative, live-priced source once it catches up.
export function mergeSignalSources(sheetSignals, waSignals) {
  const sheetStocks = new Set(sheetSignals.map((s) => s.stock.toUpperCase()));
  const freshWa = waSignals.filter((s) => !sheetStocks.has(s.stock.toUpperCase()));
  return { combined: [...sheetSignals, ...freshWa], staleWaStocks: waSignals
    .filter((s) => sheetStocks.has(s.stock.toUpperCase()))
    .map((s) => s.stock.toUpperCase()) };
}

// Rank actionable signals and mark the rest as SKIP once slots run out.
export function rankSignals(parsedRows, { openSlots }) {
  const actionable = parsedRows.filter((r) => r.isActionable);
  const rest = parsedRows.filter((r) => !r.isActionable);

  actionable.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    const aMm = a.mmPercent ?? Infinity;
    const bMm = b.mmPercent ?? Infinity;
    return aMm - bMm;
  });

  return actionable.map((r, i) => ({ ...r, rank: i + 1, willSkip: i >= openSlots })).concat(
    rest.map((r) => ({ ...r, rank: null, willSkip: true }))
  );
}

export function positionSize(entry, sl, capital, riskPercent) {
  const slPercent = Math.abs((entry - sl) / entry);
  if (slPercent === 0) return { rupiah: 0, lembar: 0 };
  const riskRupiah = capital * riskPercent;
  const rupiah = riskRupiah / slPercent;
  const lembar = Math.floor(rupiah / entry / 100) * 100; // bulatkan ke kelipatan 1 lot (100 lembar)
  return { rupiah, lembar };
}
