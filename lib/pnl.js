// Trade math for the Rekapan tab: how long a position was held, and what it
// actually made or lost. Kept out of the page so it can be unit tested - this
// is the one place in the app that turns prices into rupiah the user makes
// decisions with, and until now it lived inside a 575-line component with no
// test at all.
import { parseDDMMYYYY } from './format';

// Whole days between two journal dates ("21-09-2026"). null when either date is
// missing or malformed, so the UI can hide the line instead of showing "NaN".
export function daysHeld(entryDate, exitDate) {
  const from = parseDDMMYYYY(entryDate);
  const to = parseDDMMYYYY(exitDate);
  if (!from || !to) return null;
  return Math.round((to.setHours(0, 0, 0, 0) - from.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
}

// Net P&L after Stockbit's buy/sell fees and stamp duty (materai) - not just
// the raw price difference. Falls back to a fee-free estimate when the lot
// wasn't recorded (older entries from before this was tracked); pnlRp is null
// in that case so the UI never shows a rupiah figure it can't stand behind.
export function computeNetPnl(entry, exit, lot, settings) {
  if (!entry || !exit) return null;
  const shares = lot * 100;
  if (shares <= 0) {
    return { pnlRp: null, pnlPercent: ((exit - entry) / entry) * 100, estimated: true };
  }
  const buyValue = entry * shares;
  const sellValue = exit * shares;
  const buyMateraiHit = buyValue > settings.materaiThreshold ? settings.materaiAmount : 0;
  const sellMateraiHit = sellValue > settings.materaiThreshold ? settings.materaiAmount : 0;
  const buyCost = buyValue * (1 + settings.buyFeePercent) + buyMateraiHit;
  const sellProceeds = sellValue * (1 - settings.sellFeePercent) - sellMateraiHit;
  const pnlRp = sellProceeds - buyCost;
  return { pnlRp, pnlPercent: (pnlRp / buyCost) * 100, estimated: false };
}