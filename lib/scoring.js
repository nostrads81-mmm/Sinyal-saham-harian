// Parsing & ranking logic for the DAY TRADE watchlist sheet.
// Pure functions, no AI involved - deterministic rules only.

export function parseIndoNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

// Score (risk/reward ratio) basis, per the user's chosen basis (Settings >
// Tampilan TP):
// - 'mid' (default): the midpoint of TP1 and TP2 when TP2 is known, not TP1
//   alone - TP1 by itself is a conservative target, and averaging in TP2
//   gives a more representative reward figure for ranking signals against
//   each other. Falls back to TP1 alone when there's no TP2.
// - 'separate': TP1 alone, always - for users who'd rather judge each
//   target on its own instead of a blended number.
// tpMid is always computed and returned regardless of mode (cheap, and the
// UI only reads it when tpMode is 'mid'). This does NOT change tp1Percent,
// the "TP1 xxx%" shown to the user and copied into the AI prompt - that
// still reflects TP1 exactly, only the score/ranking basis is different.
// Rounded to a whole rupiah since it's shown to the user as "TP" on the
// card - not just an internal ratio. Exported so the journal (Rekapan) can
// show the same "TP Tengah" value for already-bought trades when Settings
// is set to the combined mode, instead of only the fresh-signal cards.
export function computeTpMid(tp1, tp2) {
  return Math.round(tp2 != null ? (tp1 + tp2) / 2 : tp1);
}

function computeScore(entry, sl, tp1, tp2, tpMode = 'mid') {
  const slPercent = Math.abs((entry - sl) / entry) * 100;
  const tpMid = computeTpMid(tp1, tp2);
  const scoreTp = tpMode === 'separate' ? tp1 : tpMid;
  const scoreTpPercent = Math.abs((scoreTp - entry) / entry) * 100;
  const score = slPercent > 0 ? scoreTpPercent / slPercent : 0;
  return { slPercent, score, tpMid };
}

// Entry price derived from the announced buy range, per the user's chosen
// basis (Settings > Basis Harga Entry): the low end, the midpoint (default -
// a balanced estimate), or the high end. Always rounded up to a whole
// rupiah, since IDX prices don't have fractions.
export function computeEntry(buyLow, buyHigh, entryMode = 'mid') {
  if (entryMode === 'low') return Math.ceil(buyLow);
  if (entryMode === 'high') return Math.ceil(buyHigh);
  return Math.ceil((buyLow + buyHigh) / 2);
}

// "118 (-6.35%)" -> { price: 118, percent: -6.35 }
export function parsePriceWithPercent(raw) {
  if (!raw || raw === '-') return { price: null, percent: null };
  const match = String(raw).match(/^([\d.,]+)\s*\(([-\d.,]+)%\)/);
  if (!match) return { price: parseIndoNumber(raw), percent: null };
  return { price: parseIndoNumber(match[1]), percent: parseFloat(match[2].replace(',', '.')) };
}

// "119-126" -> { low: 119, high: 126 }
export function parseRange(raw) {
  if (!raw) return { low: null, high: null };
  const parts = String(raw).split('-').map((p) => p.trim());
  if (parts.length !== 2) {
    const single = parseIndoNumber(raw);
    return { low: single, high: single };
  }
  return { low: parseIndoNumber(parts[0]), high: parseIndoNumber(parts[1]) };
}

// Matches "DAY TRADE - BUY BBCA : 9000-9100" (one per signal, several can
// appear in the same pasted message).
const WA_HEADER_RE = /(DAY TRADE|SWING TRADE)\s*-\s*BUY\s+([A-Z0-9]{2,6})\s*:\s*([\d.,]+)\s*-\s*([\d.,]+)/gi;

// Second, looser format seen in the wild - a single narrative sentence with
// no DAY/SWING TRADE label and no colons, e.g.:
// "INET offer bagus, retest demand di daily. maks buy 352. SL 340. TP 370."
// Only ever one signal per message in this style (unlike the structured
// admin-broadcast format above, which can bundle several) - the stock code
// is just the first word, trade type is never stated so it defaults to DAY
// TRADE (same default used elsewhere when a row doesn't say SWING TRADE),
// and there's no TP2/MM to look for.
const ALT_STOCK_RE = /^([A-Za-z]{2,6})\b/;
const ALT_BUY_RE = /\b(?:maks\.?\s*)?buy\s*([\d.,]+)/i;
const ALT_SL_RE = /\bSL\s*[:<]?\s*([\d.,]+)/i;
const ALT_TP_RE = /\bTP\s*[:.]?\s*([\d.,]+)/i;

function parseWaMessageTextAlt(raw) {
  const stockMatch = raw.trim().match(ALT_STOCK_RE);
  const buyMatch = raw.match(ALT_BUY_RE);
  const slMatch = raw.match(ALT_SL_RE);
  const tpMatch = raw.match(ALT_TP_RE);
  if (!stockMatch || !buyMatch || !slMatch || !tpMatch) return [];

  const buy = parseIndoNumber(buyMatch[1]);
  const sl = parseIndoNumber(slMatch[1]);
  const tp1 = parseIndoNumber(tpMatch[1]);
  if (buy == null || sl == null || tp1 == null) return [];

  return [{
    stock: stockMatch[1].toUpperCase(),
    tradeType: 'DAY TRADE',
    buyLow: buy,
    buyHigh: buy,
    sl,
    tp1,
    tp2: undefined,
    // Less certain than the structured format - no explicit trade type and
    // a single buy price instead of a range, so flag it for a manual check.
    confidence: 'low',
  }];
}

// Third format seen in the wild - the stock code alone on its own line,
// followed by clearly labeled fields (colon-separated), e.g.:
// "PTRO\nEntry : 4925-5075\nTP 1 : 5175\nTP 2 : 5375\nTP 3 : 5625\nSL : 4750\nHigh risk"
// Only one signal per message like the narrative alt-format, and no trade
// type stated (defaults to DAY TRADE) - but every field is explicitly
// labeled here, so this reads as "high" confidence like the structured
// admin-broadcast format, not "low" like the ambiguous narrative one. TP3
// and the risk label aren't kept - WA_Signals has no TP3 column, matching
// every other format here, which also stops at TP2. Tagged "koko_saham" -
// this is the one format that group's admin uses, so recognizing the shape
// doubles as identifying the source for the badge shown in Sinyal/Rekapan.
const ENTRY_STOCK_RE = /^\s*([A-Za-z]{2,6})\s*$/m;
const ENTRY_RANGE_RE = /\bEntry\s*:?\s*([\d.,]+)\s*-\s*([\d.,]+)/i;
const ENTRY_TP1_RE = /\bTP\s*1\s*:?\s*([\d.,]+)/i;
const ENTRY_TP2_RE = /\bTP\s*2\s*:?\s*([\d.,]+)/i;
const ENTRY_SL_RE = /\bSL\s*:?\s*([\d.,]+)/i;

function parseWaMessageTextEntryLabeled(raw) {
  const stockMatch = raw.match(ENTRY_STOCK_RE);
  const rangeMatch = raw.match(ENTRY_RANGE_RE);
  const slMatch = raw.match(ENTRY_SL_RE);
  const tp1Match = raw.match(ENTRY_TP1_RE);
  if (!stockMatch || !rangeMatch || !slMatch || !tp1Match) return [];

  const buyLow = parseIndoNumber(rangeMatch[1]);
  const buyHigh = parseIndoNumber(rangeMatch[2]);
  const sl = parseIndoNumber(slMatch[1]);
  const tp1 = parseIndoNumber(tp1Match[1]);
  if (buyLow == null || buyHigh == null || sl == null || tp1 == null) return [];

  const tp2Match = raw.match(ENTRY_TP2_RE);
  const tp2 = tp2Match ? parseIndoNumber(tp2Match[1]) : undefined;

  return [{
    stock: stockMatch[1].toUpperCase(),
    tradeType: 'DAY TRADE',
    buyLow,
    buyHigh,
    sl,
    tp1,
    tp2,
    confidence: 'high',
    tag: 'koko_saham',
  }];
}

// Deterministic parser for known WA-announcement text formats (see
// WA_SIGNAL_PROMPT in pages/api/extract-screenshot.js for the primary shape
// this mirrors) - lets a copy-pasted message skip the Gemini round trip
// entirely when it already matches a known layout, instead of waiting a
// few seconds on an AI call for something a handful of regexes can read
// instantly and for free. Returns [] (not an error) when the text doesn't
// look like any known format, so the caller can fall back to the AI
// extraction endpoint for anything looser/unexpected.
export function parseWaMessageText(text) {
  const raw = String(text || '');
  const headers = [...raw.matchAll(WA_HEADER_RE)];
  if (headers.length === 0) {
    const entryLabeled = parseWaMessageTextEntryLabeled(raw);
    if (entryLabeled.length > 0) return entryLabeled;
    return parseWaMessageTextAlt(raw);
  }

  const signals = [];
  for (let i = 0; i < headers.length; i++) {
    const match = headers[i];
    const blockEnd = i + 1 < headers.length ? headers[i + 1].index : raw.length;
    const block = raw.slice(match.index + match[0].length, blockEnd);

    const buyLow = parseIndoNumber(match[3]);
    const buyHigh = parseIndoNumber(match[4]);

    const slMatch = block.match(/SL(?:\s+IF\s+CLOSE)?\s*(?::|<)\s*([\d.,]+)/i);
    const sl = slMatch ? parseIndoNumber(slMatch[1]) : null;

    const tp1Matches = [...block.matchAll(/TP\s*1\s*:\s*([\d.,]+)/gi)];
    const tp2Match = block.match(/TP\s*2\s*:\s*([\d.,]+)/i);
    const tp1 = tp1Matches[0] ? parseIndoNumber(tp1Matches[0][1]) : null;
    let tp2 = tp2Match ? parseIndoNumber(tp2Match[1]) : null;
    // Admin typo: "TP 1" written twice instead of "TP 1" then "TP 2" - the
    // second occurrence counts as TP2 only if it's actually further out.
    if (tp2 == null && tp1Matches.length > 1) {
      const second = parseIndoNumber(tp1Matches[1][1]);
      if (second != null && tp1 != null && second > tp1) tp2 = second;
    }

    const mmMatch = block.match(/MM\s*:\s*([\d.,]+)\s*%/i);
    const mmPercent = mmMatch ? parseIndoNumber(mmMatch[1]) : null;

    if (buyLow == null || buyHigh == null || sl == null || tp1 == null) continue;

    signals.push({
      stock: match[2].toUpperCase(),
      tradeType: match[1].toUpperCase(),
      buyLow,
      buyHigh,
      sl,
      tp1,
      tp2: tp2 ?? undefined,
      mmPercent: mmPercent ?? undefined,
      confidence: 'high',
    });
  }
  return signals;
}

export function parseSheetDate(raw) {
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

// Every watchlist row as-is, no filtering by TP-hit status or missing
// SL/TP/buy-range like parseWatchlistRows() does - that one is tuned for
// "what's actionable right now" (feeds the Sinyal recommendation list),
// this one is for a read-only viewer tab that should just show the source
// sheet's data, including rows an actionable-signal view would drop.
export function parseWatchlistRowsRaw(rows) {
  const { columnMap: COL, dataRows } = locateWatchlistTable(rows);
  const parsed = [];
  for (const row of dataRows) {
    const stock = (row[COL.STOCK] || '').trim();
    if (!stock) continue;
    parsed.push({
      stock,
      tradeType: (row[COL.KETERANGAN] || '').trim().toUpperCase(),
      date: (row[COL.DATE] || '').trim(),
      buyPrice: (row[COL.BUY_PRICE] || '').trim(),
      lastPrice: (row[COL.LAST_PRICE] || '').trim(),
      sl: (row[COL.SL] || '').trim(),
      tp1: (row[COL.TP1] || '').trim(),
      tp2: (row[COL.TP2] || '').trim(),
      tp3: (row[COL.TP3] || '').trim(),
      status: (row[COL.STATUS] || '').trim().toUpperCase(),
      detailStatus: (row[COL.DETAIL_STATUS] || '').trim(),
      mmPercent: (row[COL.MM_PERCENT] || '').trim(),
    });
  }
  return parsed;
}

export function parseWatchlistRows(rows, {
  tradeType = ['DAY TRADE', 'SWING TRADE'], now = new Date(), entryMode = 'mid', tpMode = 'mid',
} = {}) {
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

    // Entry point rule (revised 2026-08-12): use whichever point of the buy
    // range the user picked in Settings (low/mid/high) - mid is the default
    // balanced estimate, rounded UP when it lands on a fraction (e.g. 151.5
    // -> 152) since IDX prices are whole rupiah. The full range is kept on
    // the signal too (buyLow/buyHigh) so the UI can show it alongside the
    // entry. We still flag "wait" when price hasn't even reached the range
    // yet.
    const entry = computeEntry(buyRange.low, buyRange.high, entryMode);
    const waitFor = lastPrice !== null && lastPrice < buyRange.low ? buyRange.low : null;

    const { slPercent, score, tpMid } = computeScore(entry, sl.price, tp1.price, tp2.price, tpMode);
    const tp1Percent = Math.abs((tp1.price - entry) / entry) * 100;

    const isOpen = status.startsWith('OPEN');
    const isRunning = status.startsWith('RUNNING');

    parsed.push({
      stock,
      tradeType: keterangan,
      date,
      ageDays,
      entry,
      buyLow: buyRange.low,
      buyHigh: buyRange.high,
      waitFor,
      sl: sl.price,
      slPercent,
      tp1: tp1.price,
      tp1Percent,
      tp2: tp2.price,
      tpMid,
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

// Turns a WA-announcement extraction (see lib/sheets.js's WA_Signals helpers)
// into the same signal shape as parseWatchlistRows(), so both sources can be ranked
// together. Same entry rule as the sheet-based signals: the midpoint of the
// buy range, rounded up on a fraction. The full range is kept on the
// signal too so the UI can show it alongside the midpoint.
export function buildWaSignal({
  stock, tradeType, buyLow, buyHigh, sl, tp1, tp2, mmPercent, capturedAt, entryMode = 'mid', tpMode = 'mid',
  watchlistDate = null, tag = null,
}) {
  const resolvedTradeType = tradeType === 'SWING TRADE' ? 'SWING TRADE' : 'DAY TRADE';
  const entry = computeEntry(buyLow, buyHigh, entryMode);
  const { slPercent, score, tpMid } = computeScore(entry, sl, tp1, tp2, tpMode);
  const tp1Percent = Math.abs((tp1 - entry) / entry) * 100;

  return {
    stock: stock.trim().toUpperCase(),
    tradeType: resolvedTradeType,
    date: capturedAt ? new Date(capturedAt) : new Date(),
    // Kept alongside `date` (a parsed Date) so the entry-price editor can
    // write this exact original value straight back to the sheet without
    // reformatting it through toISOString() and risking a mismatch.
    capturedAt: capturedAt || new Date().toISOString(),
    // Umur sinyal ikut tanggal Watchlist SELAMA sahamnya masih ada di sana
    // (dicocokkan berdasarkan stock saat render, bukan snapshot capturedAt) -
    // begitu sudah tidak ada di Watchlist lagi, dianggap "Terbit hari ini".
    ageDays: watchlistDate ? (daysBetween(watchlistDate, new Date()) || 0) : 0,
    entry,
    buyLow,
    buyHigh,
    estimatedEntry: true,
    waitFor: null,
    sl,
    slPercent,
    tp1,
    tp1Percent,
    tp2: tp2 || null,
    tpMid,
    tp3: null,
    status: 'OPEN (WA)',
    detailStatus: '',
    highestTpReached: 0,
    mmPercent: mmPercent || null,
    tag,
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
// - A per-stock MM ceiling (the signal's own "MM %" field, e.g. 10 = at most
//   10% of the modal for that stock) also caps the size: the buy value is the
//   smallest of the risk formula, the MM ceiling, and the even per-slot
//   budget. `capReason` records which of the three actually decided it, so the
//   UI can say the real reason instead of always blaming the modal.
// - Only the top `availableSlots` candidates (by score) get a slot; the rest
//   are "slot-penuh". Within a granted slot, if even an even split can't
//   cover 1 lot (100 shares), that one is "modal-habis" instead - or
//   "batas-mm" when the stock's own MM ceiling was what made it too small.
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
    // The signal's own MM ceiling, as a percent of the TOTAL modal (10 -> at
    // most 10% of it). Absent/0 means "no MM ceiling", and the Infinity
    // fallback is what makes that behave exactly like the old two-cap version
    // for signals that never carried a MM value.
    const mmCap = r.mmPercent != null && r.mmPercent > 0
      ? capital * (r.mmPercent / 100)
      : Infinity;
    const caps = [
      { reason: 'risiko', rupiah: full.rupiah },
      { reason: 'mm', rupiah: mmCap },
      { reason: 'jatah', rupiah: perSlotBudget },
    ];
    const binding = caps.reduce((smallest, c) => (c.rupiah < smallest.rupiah ? c : smallest));
    const lembar = Math.floor(binding.rupiah / r.entry / 100) * 100;

    if (lembar <= 0) {
      return {
        ...r,
        rank: i + 1,
        willSkip: true,
        // A MM ceiling that can't even buy 1 lot is a different story for the
        // user than "modal habis" - the modal may be fine, the MM entry is
        // what's too small for this stock's price.
        skipReason: binding.reason === 'mm' ? 'batas-mm' : 'modal-habis',
        position: { rupiah: 0, lembar: 0 },
        capReason: binding.reason,
      };
    }

    return {
      ...r, rank: i + 1, willSkip: false, skipReason: null,
      position: { rupiah: lembar * r.entry, lembar },
      // Only a cap below the risk-based size counts as adjusted; when the risk
      // formula itself is the smallest, `binding` is that same 'risiko' entry
      // and lembar equals full.lembar.
      adjusted: lembar < full.lembar,
      capReason: binding.reason,
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
