// Trade math for the Rekapan tab: how long a position was held, and what it
// actually made or lost. Kept out of the page so it can be unit tested - this
// is the one place in the app that turns prices into rupiah the user makes
// decisions with, and until now it lived inside a 575-line component with no
// test at all.
import { parseDDMMYYYY, parseLotFromCatatan } from './format';

// Whole days between two journal dates ("21-09-2026"). null when either date is
// missing or malformed, so the UI can hide the line instead of showing "NaN".
export function daysHeld(entryDate, exitDate) {
  const from = parseDDMMYYYY(entryDate);
  const to = parseDDMMYYYY(exitDate);
  if (!from || !to) return null;
  return Math.round((to.setHours(0, 0, 0, 0) - from.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
}

// Net P&L after Stockbit's buy/sell fees - not just the raw price
// difference. No materai (stamp duty) term: real broker statements (buy fee
// 0,15% of nilai beli, sell fee 0,25% of nilai jual, matched exactly against
// actual Stockbit transactions) show it isn't actually charged per trade the
// way this used to model it, so it's been dropped from the formula rather
// than kept as a line item that silently overstated every loss and
// understated every profit. Falls back to a fee-free estimate when the lot
// wasn't recorded (older entries from before this was tracked); pnlRp is null
// in that case so the UI never shows a rupiah figure it can't stand behind.
export function computeNetPnl(entry, exit, lot, settings) {
  if (!entry || !exit) return null;
  const shares = lot * 100;
  if (shares <= 0) {
    return { pnlRp: null, pnlPercent: ((exit - entry) / entry) * 100, estimated: true };
  }
  const buyCost = buyCostFor(entry, lot, settings);
  const sellProceeds = exit * shares * (1 - settings.sellFeePercent);
  const pnlRp = sellProceeds - buyCost;
  return { pnlRp, pnlPercent: (pnlRp / buyCost) * 100, estimated: false };
}

// Shared by computeNetPnl and computeEntryTotalPnl below - what it actually
// cost (fee included) to buy `lot` at `entry`.
function buyCostFor(entry, lot, settings) {
  return entry * lot * 100 * (1 + settings.buyFeePercent);
}

// Total lot already sold off via partial sells ("Jual sebagian") - 0 when
// none recorded. Catatan's "Lot: N" is always the ORIGINAL full bought lot
// and never decremented, so remaining lot = that minus this sum.
export function sumPartialSellLot(partialSells) {
  return (partialSells || []).reduce((sum, p) => sum + p.lot, 0);
}

// Realized P&L (rupiah) from partial sells alone, at their own recorded
// exit prices - counted whether the row is still RUNNING (partially sold,
// position still open) or already fully closed, since rupiah already
// banked from a partial sell doesn't wait for the rest of the position to
// close to become real.
function sumPartialSellPnl(entry, partialSells, settings) {
  return (partialSells || []).reduce((sum, p) => {
    const net = computeNetPnl(entry, p.hargaExit, p.lot, settings);
    return sum + (net?.pnlRp || 0);
  }, 0);
}

// Combined P&L (rupiah + percent) for ONE fully/partially sold journal row -
// what the Rekapan "Sudah terjual" list shows per row. Blends every
// partial sell with whatever lot was left at the final exit (hargaExit),
// weighting the combined percent by each piece's own buy cost - a row
// that banked a big profit on an early partial sell isn't misrepresented
// by a weak final exit on the small remainder alone. Returns the same
// shape as computeNetPnl ({ pnlRp, pnlPercent, estimated }), null if
// there's nothing sold at all yet.
export function computeEntryTotalPnl(entry, settings) {
  if (!entry.entry) return null;
  const totalLot = parseLotFromCatatan(entry.catatan);
  const remainingLot = totalLot - sumPartialSellLot(entry.partialSells);
  const sells = [...(entry.partialSells || [])];
  if (remainingLot > 0 && entry.hargaExit) sells.push({ hargaExit: entry.hargaExit, lot: remainingLot });
  if (sells.length === 0) return null;

  let pnlRp = 0;
  let buyCost = 0;
  for (const s of sells) {
    if (!s.lot || s.lot <= 0) continue;
    const net = computeNetPnl(entry.entry, s.hargaExit, s.lot, settings);
    if (!net || net.estimated) continue;
    pnlRp += net.pnlRp;
    buyCost += buyCostFor(entry.entry, s.lot, settings);
  }
  if (buyCost === 0) return null;
  return { pnlRp, pnlPercent: (pnlRp / buyCost) * 100, estimated: false };
}

// All-time realized P&L (rupiah) across every journal entry - used to
// derive Total Modal (Modal Awal +/- untung-rugi) on Sinyal, not just
// whatever's currently visible on the Rekapan screen. Entries with no
// recorded lot (pre-fee-tracking, estimate-only) contribute nothing here,
// same as computeNetPnl's own estimate-only case. Three sources, all
// additive: partial sells (any status), plus - only for a fully closed
// row - whatever lot was left over at the final exit price.
export function sumRealizedPnl(journalEntries, settings) {
  return journalEntries.reduce((sum, e) => {
    let pnl = 0;
    if (e.partialSells?.length) {
      pnl += sumPartialSellPnl(e.entry, e.partialSells, settings);
    }
    if (e.status === 'CLOSE-PROFIT' || e.status === 'CLOSE-LOSS') {
      const totalLot = parseLotFromCatatan(e.catatan);
      const remainingLot = totalLot - sumPartialSellLot(e.partialSells);
      if (remainingLot > 0) {
        const net = computeNetPnl(e.entry, e.hargaExit, remainingLot, settings);
        pnl += net?.pnlRp || 0;
      }
    }
    return sum + pnl;
  }, 0);
}