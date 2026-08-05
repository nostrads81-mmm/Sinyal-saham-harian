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

// "HIT TP 2, HOLD & SET TS DI TP 1" -> 2. Returns 0 if no "HIT TP n" found.
function parseHighestTpReached(detailStatus) {
  const matches = [...String(detailStatus || '').toUpperCase().matchAll(/HIT TP\s*(\d)/g)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((m) => Number(m[1])));
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
  TP3: ['TP 3', 'TP3'],
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

export function parseWatchlistRows(rows, { tradeType = ['DAY TRADE', 'SWING TRADE'], now = new Date() } = {}) {
  const { columnMap: COL, dataRows } = locateWatchlistTable(rows);
  const allowedTypes = tradeType
    ? (Array.isArray(tradeType) ? tradeType : [tradeType]).map((t) => t.trim().toUpperCase())
    : null;
  const parsed = [];
  for (const row of dataRows) {
    const keterangan = (row[COL.KETERANGAN] || '').trim().toUpperCase();
    if (allowedTypes && !allowedTypes.includes(keterangan)) continue;

    const stock = (row[COL.STOCK] || '').trim();
    if (!stock) continue;

    const dateRaw = row[COL.DATE];
    const date = parseSheetDate(dateRaw);
    const buyRange = parseRange(row[COL.BUY_PRICE]);
    const lastPrice = parseIndoNumber(row[COL.LAST_PRICE]);
    const sl = parsePriceWithPercent(row[COL.SL]);
    const tp1 = parsePriceWithPercent(row[COL.TP1]);
    const tp2 = parsePriceWithPercent(row[COL.TP2]);
    const tp3 = parsePriceWithPercent(row[COL.TP3]);
    const status = (row[COL.STATUS] || '').trim().toUpperCase();
    const detailStatus = (row[COL.DETAIL_STATUS] || '').trim();
    const mmPercent = parseIndoNumber(row[COL.MM_PERCENT]);
    const ageDays = daysBetween(date, new Date(now));
    const highestTpReached = parseHighestTpReached(detailStatus);

    if (sl.price === null || tp1.price === null || buyRange.high === null) continue;
    // Drop entirely once ANY TP has been hit - it's no longer a fresh entry
    // opportunity once the trade is already in profit-taking territory.
    if (highestTpReached >= 1) continue;

    // Single entry point rule (revised 2026-08-07): use the midpoint of the
    // buy range as a balanced estimate. We still flag "wait" when price
    // hasn't even reached the range yet.
    const entry = (buyRange.low + buyRange.high) / 2;
    const waitFor = lastPrice !== null && lastPrice < buyRange.low ? buyRange.low : null;

    const slPercent = Math.abs((entry - sl.price) / entry) * 100;
    const tp1Percent = Math.abs((tp1.price - entry) / entry) * 100;
    const score = slPercent > 0 ? tp1Percent / slPercent : 0;

    const isOpen = status.startsWith('OPEN');
    const isRunning = status.startsWith('RUNNING');

    parsed.push({
      stock,
      tradeType: keterangan,
      date,
      ageDays,
      entry,
      waitFor,
      sl: sl.price,
      slPercent,
      tp1: tp1.price,
      tp1Percent,
      tp2: tp2.price,
      tp3: tp3.price,
      status,
      detailStatus,
      highestTpReached,
      mmPercent,
      score,
      isOpen,
      isRunning,
      isActionable: isOpen,
      estimatedEntry: true,
      source: 'sheet',
    });
  }
  return parsed;
}

// Turns a WA-announcement extraction (see lib/waSignals.js) into the same
// signal shape as parseWatchlistRows(), so both sources can be ranked
// together. Same entry rule as the sheet-based signals: the midpoint of the
// buy range.
export function buildWaSignal({ stock, tradeType, buyLow, buyHigh, sl, tp1, tp2, mmPercent, capturedAt }) {
  const entry = (buyLow + buyHigh) / 2;
  const slPercent = Math.abs((entry - sl) / entry) * 100;
  const tp1Percent = Math.abs((tp1 - entry) / entry) * 100;
  const score = slPercent > 0 ? tp1Percent / slPercent : 0;

  return {
    stock: stock.trim().toUpperCase(),
    tradeType: tradeType === 'SWING TRADE' ? 'SWING TRADE' : 'DAY TRADE',
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
    tp3: null,
    status: 'OPEN (WA)',
    detailStatus: '',
    highestTpReached: 0,
    mmPercent: mmPercent || null,
    score,
    isOpen: true,
    isRunning: false,
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

// Attaches slot + budget-based rank/position info to every OPEN signal, and
// passes everything else through untouched. Returns the FULL list, still
// mixed - grouping by publish date ("hari ini" vs "kemarin") happens
// separately in the page.
//
// Model (2026-08-03, revised after the greedy version left tiny leftovers
// for lower-ranked candidates - e.g. a new signal getting only ~19 lot just
// because it happened to be evaluated after others already ate most of the
// budget):
// - There's a hard cap of `maxSlots` concurrent positions. `occupiedSlots`
//   (RUNNING journal entries) eats into that cap first - closing a position
//   in the journal frees a slot back up automatically next fetch.
// - The remaining capital is split EVENLY across the remaining open slots,
//   not handed out first-come-first-served, so every candidate gets a fair
//   per-slot budget instead of scraps.
// - A stock already sitting in the journal (bought) doesn't compete for a
//   slot at all - it's marked "sudah-terbeli" separately.
// - Only the top `availableSlots` candidates (by score) get a slot; the rest
//   are "slot-penuh". Within a granted slot, if even an even split can't
//   cover 1 lot (100 shares), that one is "modal-habis" instead.
export function rankSignals(parsedRows, {
  capital, riskPercent, remainingCapital, maxSlots, occupiedSlots, journaledStocks = new Set(),
}) {
  const alreadyBought = (r) => journaledStocks.has(r.stock.toUpperCase());

  const openRows = parsedRows.filter((r) => r.isOpen && !alreadyBought(r));
  const journaledOpenRows = parsedRows.filter((r) => r.isOpen && alreadyBought(r));
  const otherRows = parsedRows.filter((r) => !r.isOpen);

  openRows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aMm = a.mmPercent ?? Infinity;
    const bMm = b.mmPercent ?? Infinity;
    if (aMm !== bMm) return aMm - bMm;
    // Tie-breaker 3: fresher signal wins - an OPEN signal that's sat unfilled
    // for days despite a good on-paper score suggests the price just isn't
    // moving toward it, so a same-score newer signal is the better bet.
    const aAge = a.ageDays ?? Infinity;
    const bAge = b.ageDays ?? Infinity;
    return aAge - bAge;
  });

  const availableSlots = Math.max(maxSlots - occupiedSlots, 0);
  // Split the remaining budget across however many candidates will ACTUALLY
  // fill a slot today (min of available slots and candidates on hand) - not
  // the full slot capacity. Reserving a share for empty slots 3-4 when only
  // 2 signals exist today just shrinks everyone's position for no reason;
  // tomorrow's fresh fetch recalculates from scratch anyway once more
  // signals (or a closed position) show up.
  const slotsToFill = Math.min(availableSlots, openRows.length);
  const perSlotBudget = slotsToFill > 0 ? remainingCapital / slotsToFill : 0;

  const rankedOpen = openRows.map((r, i) => {
    if (i >= availableSlots) {
      return { ...r, rank: i + 1, willSkip: true, skipReason: 'slot-penuh', position: { rupiah: 0, lembar: 0 } };
    }

    const full = positionSize(r.entry, r.sl, capital, riskPercent);
    const cappedRupiah = Math.min(full.rupiah, perSlotBudget);
    const lembar = Math.floor(cappedRupiah / r.entry / 100) * 100;

    if (lembar <= 0) {
      return { ...r, rank: i + 1, willSkip: true, skipReason: 'modal-habis', position: { rupiah: 0, lembar: 0 } };
    }

    return {
      ...r, rank: i + 1, willSkip: false, skipReason: null,
      position: { rupiah: lembar * r.entry, lembar }, adjusted: lembar < full.lembar,
    };
  });

  const passthroughJournaled = journaledOpenRows.map((r) => ({
    ...r, rank: null, willSkip: true, skipReason: 'sudah-terbeli', position: { rupiah: 0, lembar: 0 }, owned: true,
  }));
  const passthroughOthers = otherRows.map((r) => ({
    ...r, rank: null, willSkip: false, skipReason: null, position: null, owned: alreadyBought(r),
  }));

  return [
    ...rankedOpen.map((r) => ({ ...r, owned: false })),
    ...passthroughJournaled,
    ...passthroughOthers,
  ];
}

// Splits a signal list into "hari ini" (published today) vs "kemarin"
// (everything else) - pure date partition, independent of OPEN/RUNNING
// status. Each bucket is sorted best-first (not-skipped, then by score).
export function partitionByDate(signals) {
  const rank = (s) => (s.willSkip ? 1 : 0);
  const sortBest = (a, b) => (rank(a) - rank(b)) || (b.score - a.score);

  const today = signals.filter((s) => s.ageDays === 0).sort(sortBest);
  const previous = signals.filter((s) => s.ageDays !== 0).sort(sortBest);
  return { today, previous };
}

export function positionSize(entry, sl, capital, riskPercent) {
  const slPercent = Math.abs((entry - sl) / entry);
  if (slPercent === 0) return { rupiah: 0, lembar: 0 };
  const riskRupiah = capital * riskPercent;
  const rupiah = riskRupiah / slPercent;
  const lembar = Math.floor(rupiah / entry / 100) * 100; // bulatkan ke kelipatan 1 lot (100 lembar)
  return { rupiah, lembar };
}
