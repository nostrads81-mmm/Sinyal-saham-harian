import { useEffect, useState } from 'react';
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

export default function SettingsSheet({
  open, onClose, capital, maxSlots, entryMode, tpMode, onSave, saving,
}) {
  const [capitalInput, setCapitalInput] = useState(String(capital));
  const [slotsInput, setSlotsInput] = useState(String(maxSlots));
  const [entryModeInput, setEntryModeInput] = useState('mid');
  const [tpModeInput, setTpModeInput] = useState('mid');
  const [theme, setTheme] = useState('dark');
  const [textScale, setTextScale] = useState('normal');
  const [bold, setBold] = useState(false);

  useEffect(() => {
    if (open) {
      setCapitalInput(String(capital));
      setSlotsInput(String(maxSlots));
      setEntryModeInput(entryMode || 'mid');
      setTpModeInput(tpMode || 'mid');
      setTheme(getStoredTheme());
      setTextScale(getStoredTextScale());
      setBold(getStoredBold());
    }
  }, [open, capital, maxSlots, entryMode, tpMode]);

  if (!open) return null;

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
            <label className="field-label">Jumlah slot saham</label>
            <input
              type="number"
              value={slotsInput}
              onChange={(e) => setSlotsInput(e.target.value)}
            />
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

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Batal</button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => onSave({
              capital: Number(capitalInput) || capital,
              maxSlots: Number(slotsInput) || maxSlots,
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
