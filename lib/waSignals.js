// Local (per-device) buffer for signals captured from WhatsApp announcements,
// used while the source Google Sheet hasn't caught up yet. Deliberately NOT
// stored in Google Sheets - this is a transient staging area, see
// lib/scoring.js's mergeSignalSources() for how it gets reconciled away.

// Bumped to _v2 on 2026-08-06 to start every device with an empty buffer -
// the watchlist sheet source was paused around the same time, so old WA
// signals staged under the previous key shouldn't resurface as if fresh.
const STORAGE_KEY = 'wa_signals_buffer_v2';

export function getWaSignals() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWaSignals(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function addWaSignal(signal) {
  const list = getWaSignals().filter((s) => s.stock.toUpperCase() !== signal.stock.toUpperCase());
  list.push(signal);
  saveWaSignals(list);
  return list;
}

export function removeWaSignal(stock) {
  const list = getWaSignals().filter((s) => s.stock.toUpperCase() !== stock.toUpperCase());
  saveWaSignals(list);
  return list;
}

// Called after every fetch of the sheet-based signals: any WA signal whose
// stock now has a proper sheet entry is no longer needed.
export function pruneStaleWaSignals(staleStocks) {
  if (staleStocks.length === 0) return getWaSignals();
  const staleSet = new Set(staleStocks.map((s) => s.toUpperCase()));
  const list = getWaSignals().filter((s) => !staleSet.has(s.stock.toUpperCase()));
  saveWaSignals(list);
  return list;
}
