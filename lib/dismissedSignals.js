// Local (per-device) list of sheet-sourced signals the user dismissed from
// the Sinyal list. The app can't delete rows from the external watchlist
// sheet, so "hapus" here just means "stop showing me this stock" - keyed by
// stock symbol alone (not stock+date) so it also covers duplicate rows for
// the same stock or a re-listing under a new date, matching how WA-sourced
// "hapus" (removeWaSignal) already works.

const STORAGE_KEY = 'dismissed_signals';

function read() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getDismissedSignals() {
  return read().map((entry) => entry.stock);
}

export function dismissSignal(stock) {
  const key = stock.toUpperCase();
  const list = read().filter((entry) => entry.stock !== key);
  list.push({ stock: key, dismissedAt: Date.now() });
  write(list);
}

// Dismissals older than maxAgeDays are dropped, so a stock isn't hidden
// forever - just long enough that the same signal round doesn't keep
// reappearing.
export function pruneStaleDismissals(maxAgeDays = 14) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const list = read().filter((entry) => entry.dismissedAt >= cutoff);
  write(list);
}
