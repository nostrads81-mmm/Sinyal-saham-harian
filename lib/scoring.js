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

// rows: 2D array from Sheets API, one row per signal, columns matching
// DATE, STOCK, BUY PRICE, LAST PRICE, P&L%, SL, TP1, TP2, TP3, STATUS, DETAIL STATUS, MM%, ..., KETERANGAN
const COL = {
  DATE: 0,
  STOCK: 1,
  BUY_PRICE: 2,
  LAST_PRICE: 3,
  PNL_PERCENT: 4,
  SL: 5,
  TP1: 6,
  TP2: 7,
  TP3: 8,
  STATUS: 9,
  DETAIL_STATUS: 10,
  MM_PERCENT: 11,
  KETERANGAN: 15,
};

export function parseWatchlistRows(rows, { tradeType = 'DAY TRADE', now = new Date() } = {}) {
  const parsed = [];
  for (const row of rows) {
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
    const isFreshRunning = status.startsWith('RUNNING') && detailStatus.toUpperCase().includes('NEW');

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
    });
  }
  return parsed;
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
