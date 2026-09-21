// Shared formatting/parsing helpers for the screens.
//
// These each lived twice - once in pages/index.js, once in pages/rekapan.js -
// so every tweak had to be made twice and the two copies could drift apart
// without anyone noticing. The money/date formats feed the journal sheet, so a
// drift there means two tabs disagreeing about the same trade.

export function formatRupiah(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

// Short form for dense rows ("Rp8,33 jt"), while detail views keep the exact
// figure. Rupiah amounts here run from tens of thousands to tens of millions,
// and the full form ("Rp8.333.333") is wide enough to push the numbers being
// compared out of alignment from one card to the next.
function trimTrailingZeroes(s) {
  return s.replace(/\.?0+$/, '');
}

export function formatRupiahRingkas(n) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const trim = (value, decimals) => trimTrailingZeroes(value.toFixed(decimals)).replace('.', ',');
  if (abs >= 1_000_000) return `${sign}Rp${trim(abs / 1_000_000, 2)} jt`;
  if (abs >= 1_000) return `${sign}Rp${trim(abs / 1_000, 1)} rb`;
  return `${sign}Rp${abs.toLocaleString('id-ID')}`;
}

// D-M-Y, e.g. 21-09-2026. The journal writes it with a leading "'" (see the
// row builders) so Sheets keeps it as text instead of turning it into a date
// serial number like 46237. Takes an explicit date so it can be tested.
export function todayDDMMYYYY(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

// The reverse of todayDDMMYYYY, for the dates already stored in the journal as
// text ("21-09-2026"). Returns null for anything that isn't that exact shape,
// so callers can tell "no date" apart from "1 January 1970 scraped together by
// the Date constructor".
export function parseDDMMYYYY(s) {
  const match = String(s || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

// The journal's Catatan column stores "Lot: 31" (written when recording the
// trade from the Sinyal tab). 0 means "no lot recorded" - callers turn that
// into an estimated P&L rather than a real one.
export function parseLotFromCatatan(catatan) {
  const match = String(catatan || '').match(/Lot:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}