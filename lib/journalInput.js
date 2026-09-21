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
export function parseHargaInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, error: 'Harga harus berupa angka lebih dari 0' };
  }
  return { value: n, error: null };
}

export function parseLotInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, error: null };
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { value: null, error: 'Jumlah lot harus bilangan bulat minimal 1 (1 lot = 100 lembar)' };
  }
  return { value: n, error: null };
}