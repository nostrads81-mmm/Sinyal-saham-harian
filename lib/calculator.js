// Position-size calculator (menu "Kalkulator"): given an entry/SL/TP and a
// rupiah amount the user is willing to lose, works out how many lot that
// budget actually buys and what it's worth at TP/SL - same risk-sizing
// formula as positionSize() in lib/scoring.js (used for Sinyal's automatic
// sizing), except driven by a plain rupiah figure typed in here instead of
// capital * riskPercent.
import { computeNetPnl } from './pnl';
import { parseHargaInput } from './journalInput';

// Turns the four raw strings Kalkulator's form collects into the shape
// computeCalculator expects below, or an error message. Kept as one
// function (instead of each field validated inline in the page) so the
// whole typed-input -> computeCalculator pipeline is covered by a single
// test - computeCalculator's own tests only exercise clean numbers, which
// wouldn't have caught a mismatched field name between the two leaving
// maxLoss undefined and every single calculation failing silently.
export function parseCalculatorInputs({ entryInput, slInput, tpInput, maxLossInput }) {
  const entry = parseHargaInput(entryInput);
  const sl = parseHargaInput(slInput);
  const tp = parseHargaInput(tpInput);
  const maxLoss = parseHargaInput(maxLossInput);
  if (entry.error || entry.value === null) return { error: entry.error || 'Entry wajib diisi' };
  if (sl.error || sl.value === null) return { error: sl.error || 'SL wajib diisi' };
  if (tp.error) return { error: tp.error };
  if (maxLoss.error || maxLoss.value === null) return { error: maxLoss.error || 'Maks kerugian wajib diisi' };
  if (sl.value >= entry.value) return { error: 'SL harus lebih kecil dari Entry.' };
  return { entry: entry.value, sl: sl.value, tp: tp.value, maxLoss: maxLoss.value };
}

// null when the inputs can't produce a usable position at all (SL not below
// entry, or the max-loss budget rounds down to less than 1 lot) - the page
// shows a hint instead of a result in that case.
export function computeCalculator({ entry, sl, tp, maxLoss }, settings) {
  if (!entry || !sl || !maxLoss || entry <= 0 || sl <= 0 || maxLoss <= 0) return null;
  if (sl >= entry) return null; // a long position's SL always sits below entry

  const slPercent = (entry - sl) / entry;
  const budgetRupiah = maxLoss / slPercent;
  const lembar = Math.floor(budgetRupiah / entry / 100) * 100; // bulatkan ke kelipatan 1 lot
  const lot = lembar / 100;
  if (lot <= 0) return { lot: 0, rupiahBeli: 0, slEstimate: null, tpEstimate: null };

  const rupiahBeli = entry * lembar;
  const slEstimate = computeNetPnl(entry, sl, lot, settings);
  const tpEstimate = tp ? computeNetPnl(entry, tp, lot, settings) : null;

  return { lot, rupiahBeli, slEstimate, tpEstimate };
}
