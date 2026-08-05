// Local (per-device) list of sheet-sourced signals the user dismissed from
// the Sinyal list. The app can't delete rows from the external watchlist
// sheet, so "hapus" here just means "stop showing me this one" - keyed by
// stock + publish date so a later, genuinely new signal for the same stock
// isn't hidden too.

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

export function dismissedKey(stock, date) {
  const d = date ? new Date(date).toISOString().slice(0, 10) : 'no-date';
  return `${stock.toUpperCase()}|${d}`;
}

export function getDismissedSignals() {
  return read();
}

export function dismissSignal(stock, date) {
  const key = dismissedKey(stock, date);
  const list = read();
  if (!list.includes(key)) {
    list.push(key);
    write(list);
  }
}

// Dismissals older than maxAgeDays are dropped - a signal that old wouldn't
// still be in the sheet anyway, so there's nothing left to remember hiding.
export function pruneStaleDismissals(maxAgeDays = 14) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const list = read().filter((key) => {
    const dateStr = key.split('|')[1];
    if (dateStr === 'no-date') return true;
    return new Date(dateStr).getTime() >= cutoff;
  });
  write(list);
}
