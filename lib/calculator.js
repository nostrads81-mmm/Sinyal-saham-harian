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
  const ratio = computeRiskRewardRatio(entry, sl, tp);

  return {
    lot, rupiahBeli, slEstimate, tpEstimate, ratio,
  };
}

// Risk:reward as "reward per 1 unit of risk" - a result of 5 reads as a
// "1:5" setup. null when there's no TP to compare against, or the SL isn't
// actually below entry (reward-less "risk" would be a divide-by-zero or a
// meaningless negative ratio).
export function computeRiskRewardRatio(entry, sl, tp) {
  if (!tp || !entry || !sl || sl >= entry) return null;
  const risk = entry - sl;
  const reward = tp - entry;
  return reward / risk;
}

// The entry price that would turn a fixed TP/SL pair into the given
// risk:reward ratio (same "reward per 1 unit of risk" reading as
// computeRiskRewardRatio) without moving TP or SL at all - e.g. "what
// entry gives me 1:5 on this exact TP/SL". Derived from
// ratio = (tp - entry) / (entry - sl), solved for entry:
//   tp - entry = ratio * (entry - sl)
//   entry = (tp + ratio * sl) / (1 + ratio)
// null when TP isn't above SL (no entry between them could ever satisfy
// any positive ratio) or the ratio itself isn't a usable positive number.
export function suggestEntryForRatio(sl, tp, ratio) {
  if (!sl || !tp || tp <= sl || !ratio || ratio <= 0) return null;
  return (tp + ratio * sl) / (1 + ratio);
}
