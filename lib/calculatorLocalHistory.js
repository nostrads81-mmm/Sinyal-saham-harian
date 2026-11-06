// Per-device Kalkulator history - used whenever there's no signed-in Google
// account to write Kalkulator_Histori to (see lib/sheets.js), so "Simpan ke
// Riwayat" still works without sign-in. Same row shape getCalculatorHistory
// returns (rowNumber here is just an increasing local id, not a sheet row),
// so the page can render either source with the same code.
import { safeGetItem, safeSetItem } from './storage';

const STORAGE_KEY = 'kalkulator_histori_local_v1';

function read() {
  try {
    const raw = JSON.parse(safeGetItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(list) {
  safeSetItem(STORAGE_KEY, JSON.stringify(list));
}

export function getLocalCalculatorHistory() {
  return read();
}

export function addLocalCalculatorEntry(entry) {
  const list = read();
  const nextId = (list.reduce((max, e) => Math.max(max, e.rowNumber), 0) || 0) + 1;
  list.push({ ...entry, rowNumber: nextId });
  write(list);
}

export function deleteLocalCalculatorEntry(rowNumber) {
  write(read().filter((e) => e.rowNumber !== rowNumber));
}
