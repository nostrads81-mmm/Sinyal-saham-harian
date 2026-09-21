// Local (per-device) list of stocks the user manually skipped from slot
// allocation. Different from "hapus" (dismissedSignals.js): a dismissed
// signal stops showing entirely, while a skipped one stays visible - just
// grayed out (same .skip-card treatment as an automatic slot-full skip) -
// and is excluded from rankSignals' slot competition, so the next-best
// candidate gets promoted into the slot it would have taken.
import { safeGetItem, safeSetItem } from './storage';
const STORAGE_KEY = 'skipped_signals_v1';

function read() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(safeGetItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function write(list) {
  safeSetItem(STORAGE_KEY, JSON.stringify(list));
}

export function getSkippedSignals() {
  return read().map((entry) => entry.stock);
}

export function skipSignal(stock) {
  const key = stock.toUpperCase();
  const list = read().filter((entry) => entry.stock !== key);
  list.push({ stock: key, skippedAt: Date.now() });
  write(list);
}

export function unskipSignal(stock) {
  const key = stock.toUpperCase();
  write(read().filter((entry) => entry.stock !== key));
}

// Skips older than maxAgeDays are dropped, same reasoning as
// pruneStaleDismissals - a stock shouldn't be excluded forever just because
// it was skipped once weeks ago.
export function pruneStaleSkips(maxAgeDays = 14) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  write(read().filter((entry) => entry.skippedAt >= cutoff));
}
