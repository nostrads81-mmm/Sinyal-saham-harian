// Guards for the two places a trade is typed in by hand: "Catat order" on the
// Sinyal tab, and "Tutup posisi" / "Konfirmasi fill" on Rekapan. Both write
// straight into the journal sheet, and the journal is what the modal, slot and
// P&L math reads back - so a typo like a negative price or a 0 lot doesn't just
// mislabel one row, it silently corrupts every number on both tabs.
//
// Only values that are OBVIOUSLY wrong are rejected here (not a number, <= 0,
// or a fractional lot). Nothing that could plausibly be a real price is
// blocked - that would need a decision from the owner on where "extreme but
// possible" starts, and whether to warn instead of block.

// Returns { value, error }. A null value with no error means "left empty" -
// callers keep their own fallback for that (suggested entry price, or "-" for
// an unrecorded lot, which makes the P&L an estimate rather than a guess).

// Indonesian numbers almost always arrive with a dot as the THOUSANDS separator
// ("1.000" = one thousand, "1.000.000" = one million) while a comma is the
// decimal separator ("1.500,5"). Number() reads "1.000" as 1 - a plausible
// price silently becomes Rp1. Fix it here, once, so every typed price/lot (and
// anything the AI returns as text) agrees on the same rule: only a WHOLE
// thousands-grouped number (1-3 leading digits, then dot + exactly three digits
// repeated) is unwrapped. Anything else - "1.5", "0.005" - keeps its dot as a
// real decimal point, because IDX prices and risk figures can need those.
export function localizeNumber(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return s;
  // "1.000" | "1.000.000" | "1.500,5" -> unwrap to 1000 | 1000000 | 1500.5
  const thousands = s.match(/^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/);
  if (thousands) {
    const integer = thousands[1].replace(/\./g, '');
    return thousands[2] !== undefined ? `${integer}.${thousands[2]}` : integer;
  }
  return s.replace(',', '.');
}

export function parseHargaInput(raw) {
  const s = localizeNumber(raw);
  if (s === '') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, error: 'Harga harus berupa angka lebih dari 0' };
  }
  return { value: n, error: null };
}

export function parseLotInput(raw) {
  const s = localizeNumber(raw);
  if (s === '') return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { value: null, error: 'Jumlah lot harus bilangan bulat minimal 1 (1 lot = 100 lembar)' };
  }
  return { value: n, error: null };
}