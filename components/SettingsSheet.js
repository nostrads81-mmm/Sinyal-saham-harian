import { useEffect, useState } from 'react';
import { formatRupiahRingkas } from '../lib/format';
import {
  getStoredTheme, setStoredTheme, getStoredTextScale, setStoredTextScale, getStoredBold, setStoredBold,
} from '../lib/theme';

const TEXT_SCALE_OPTIONS = [
  { value: 'kecil', label: 'Kecil' },
  { value: 'normal', label: 'Normal' },
  { value: 'besar', label: 'Besar' },
  { value: 'extra-besar', label: 'Extra' },
];

const ENTRY_MODE_OPTIONS = [
  { value: 'low', label: 'Bawah' },
  { value: 'mid', label: 'Tengah' },
  { value: 'high', label: 'Atas' },
];

const TP_MODE_OPTIONS = [
  { value: 'separate', label: 'TP1 & TP2' },
  { value: 'mid', label: 'TP Tengah' },
];

// riskPercent is stored as a fraction (e.g. 0.005) but shown to the user as
// a percentage (0,5). Keep the conversion in one place so both the input and
// the save handler agree on the format.
function riskFractionToDisplay(fraction) {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return '';
  return String(+(n * 100).toFixed(4));
}

// Empty or invalid input means "leave the stored value alone" - same as the
// Modal/Jumlah slot fields, which fall back with `|| capital`. This matters
// more here: Number('') is 0, so without the explicit empty check a cleared
// field would read as a legitimate "risiko 0%" and every position would be
// sized to 0 lot the next time signals load. 0 itself is also rejected - a
// zero risk percent can never produce a usable position size.
function riskDisplayToFraction(display) {
  if (String(display).trim() === '') return null;
  const n = Number(display);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 100;
}

export default function SettingsSheet({
  open, onClose, capital, riskPercent, maxSlots, maxPerStock,
  buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold,
  entryMode, tpMode, onSave, saving,
}) {
  const [capitalInput, setCapitalInput] = useState(String(capital));
  const [riskInput, setRiskInput] = useState(riskFractionToDisplay(riskPercent));
  const [slotsInput, setSlotsInput] = useState(String(maxSlots));
  const [maxPerStockInput, setMaxPerStockInput] = useState(maxPerStock ? String(maxPerStock) : '');
  const [buyFeeInput, setBuyFeeInput] = useState(riskFractionToDisplay(buyFeePercent));
  const [sellFeeInput, setSellFeeInput] = useState(riskFractionToDisplay(sellFeePercent));
  const [materaiInput, setMateraiInput] = useState(String(materaiAmount));
  const [materaiThresholdInput, setMateraiThresholdInput] = useState(String(materaiThreshold));
  const [entryModeInput, setEntryModeInput] = useState('mid');
  const [tpModeInput, setTpModeInput] = useState('mid');
  const [theme, setTheme] = useState('dark');
  const [textScale, setTextScale] = useState('normal');
  const [bold, setBold] = useState(false);

  useEffect(() => {
    if (open) {
      setCapitalInput(String(capital));
      setRiskInput(riskFractionToDisplay(riskPercent));
      setSlotsInput(String(maxSlots));
      setMaxPerStockInput(maxPerStock ? String(maxPerStock) : '');
      setBuyFeeInput(riskFractionToDisplay(buyFeePercent));
      setSellFeeInput(riskFractionToDisplay(sellFeePercent));
      setMateraiInput(String(materaiAmount));
      setMateraiThresholdInput(String(materaiThreshold));
      setEntryModeInput(entryMode || 'mid');
      setTpModeInput(tpMode || 'mid');
      setTheme(getStoredTheme());
      setTextScale(getStoredTextScale());
      setBold(getStoredBold());
    }
  }, [
    open, capital, riskPercent, maxSlots, maxPerStock,
    buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold, entryMode, tpMode,
  ]);

  if (!open) return null;

  // What "otomatis" would be right now, shown as a hint so the effect of leaving
  // the field empty is visible before saving.
  const autoPerStock = Number(capitalInput) > 0 && Number(slotsInput) > 0
    ? Number(capitalInput) / Number(slotsInput)
    : null;

  function chooseTheme(next) {
    setTheme(next);
    setStoredTheme(next);
  }

  function chooseTextScale(next) {
    setTextScale(next);
    setStoredTextScale(next);
  }

  function chooseBold(next) {
    setBold(next);
    setStoredBold(next);
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header-row">
          <h2 className="sheet-title">Pengaturan</h2>
          <button type="button" className="sheet-close" onClick={onClose} disabled={saving} aria-label="Tutup">
            ✕
          </button>
        </div>

        <div className="sheet-body">
        <div className="settings-section">
          <p className="settings-section-title">💰 Modal &amp; Risiko</p>
          <div className="field">
            <label className="field-label">Modal</label>
            <input
              type="number"
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">Risiko per trade (%)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              inputMode="decimal"
              value={riskInput}
              onChange={(e) => setRiskInput(e.target.value)}
            />
            <p className="field-hint">
              Persentase modal yang dirisikokan tiap posisi. Dipakai untuk menghitung ukuran posisi dari jarak entry ke stop loss.
            </p>
          </div>

          <div className="field">
            <label className="field-label">Jumlah slot saham</label>
            <input
              type="number"
              value={slotsInput}
              onChange={(e) => setSlotsInput(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">Maks per saham (Rp)</label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="otomatis"
              value={maxPerStockInput}
              onChange={(e) => setMaxPerStockInput(e.target.value)}
            />
            <p className="field-hint">
              Batas belanja untuk satu saham. Kosongkan untuk otomatis: <strong>modal ÷ jumlah slot</strong>
              {autoPerStock !== null ? ` (sekarang ${formatRupiahRingkas(autoPerStock)})` : ''}.
              Ukuran posisi tetap dihitung dari rumus risiko, ini hanya plafonnya.
            </p>
          </div>

          <div className="field">
            <label className="field-label">Basis harga entry</label>
            <div className="segmented">
              {ENTRY_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`seg-btn ${entryModeInput === opt.value ? 'active' : ''}`}
                  onClick={() => setEntryModeInput(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              Harga entry yang dipakai dari rentang buy WA - batas bawah, tengah (rata-rata), atau batas atas.
            </p>
          </div>

          <div className="field">
            <label className="field-label">Tampilan TP</label>
            <div className="segmented">
              {TP_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`seg-btn ${tpModeInput === opt.value ? 'active' : ''}`}
                  onClick={() => setTpModeInput(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="field-hint">
              TP1 &amp; TP2 tampil terpisah, atau digabung jadi satu "TP Tengah" (titik tengah keduanya). Skor sinyal ikut memakai basis yang sama.
            </p>
          </div>
        </div>

        <div className="settings-section">
          <p className="settings-section-title">🧾 Biaya &amp; Materai</p>
          <div className="field">
            <label className="field-label">Fee beli (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={buyFeeInput}
              onChange={(e) => setBuyFeeInput(e.target.value)}
            />
            <p className="field-hint">
              Komisi broker saat beli, sebagai persen dari nilai (0,15 = 0,15%). Dihitung dalam P&amp;L bersih di Rekapan.
            </p>
          </div>

          <div className="field">
            <label className="field-label">Fee jual (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={sellFeeInput}
              onChange={(e) => setSellFeeInput(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">Materai per tiap sisi (Rp)</label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={materaiInput}
              onChange={(e) => setMateraiInput(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">Batas kena materai (Rp)</label>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={materaiThresholdInput}
              onChange={(e) => setMateraiThresholdInput(e.target.value)}
            />
            <p className="field-hint">
              Materai kena tiap sisi saja kalau nilai transaksi melebihi batas ini.
            </p>
          </div>
        </div>

        <div className="settings-section">
          <p className="settings-section-title">🎨 Tampilan</p>
          <div className="field">
            <label className="field-label">Tema</label>
            <div className="segmented">
              <button
                type="button"
                className={`seg-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => chooseTheme('dark')}
              >
                Gelap
              </button>
              <button
                type="button"
                className={`seg-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => chooseTheme('light')}
              >
                Terang
              </button>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Ukuran teks</label>
            <div className="segmented">
              {TEXT_SCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`seg-btn ${textScale === opt.value ? 'active' : ''}`}
                  onClick={() => chooseTextScale(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Ketebalan teks</label>
            <div className="segmented">
              <button
                type="button"
                className={`seg-btn ${!bold ? 'active' : ''}`}
                onClick={() => chooseBold(false)}
              >
                Normal
              </button>
              <button
                type="button"
                className={`seg-btn ${bold ? 'active' : ''}`}
                onClick={() => chooseBold(true)}
              >
                Tebal
              </button>
            </div>
          </div>
        </div>
        </div>

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Batal</button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => onSave({
              capital: Number(capitalInput) || capital,
              riskPercent: riskDisplayToFraction(riskInput) ?? riskPercent,
              maxSlots: Number(slotsInput) || maxSlots,
              // Empty means "automatic: modal / jumlah slot" - 0 is stored, and
              // lib/scoring.js reads 0 as "use the even share".
              maxPerStock: Number(maxPerStockInput) || 0,
              buyFeePercent: riskDisplayToFraction(buyFeeInput) ?? buyFeePercent,
              sellFeePercent: riskDisplayToFraction(sellFeeInput) ?? sellFeePercent,
              materaiAmount: Number(materaiInput) || materaiAmount,
              materaiThreshold: Number(materaiThresholdInput) || materaiThreshold,
              entryMode: entryModeInput,
              tpMode: tpModeInput,
            })}
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
