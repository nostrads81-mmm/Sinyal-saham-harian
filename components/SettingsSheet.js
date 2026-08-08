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

export default function SettingsSheet({ open, onClose, capital, maxSlots, onSave, saving }) {
  const [capitalInput, setCapitalInput] = useState(String(capital));
  const [slotsInput, setSlotsInput] = useState(String(maxSlots));
  const [theme, setTheme] = useState('dark');
  const [textScale, setTextScale] = useState('normal');
  const [bold, setBold] = useState(false);

  useEffect(() => {
    if (open) {
      setCapitalInput(String(capital));
      setSlotsInput(String(maxSlots));
      setTheme(getStoredTheme());
      setTextScale(getStoredTextScale());
      setBold(getStoredBold());
    }
  }, [open, capital, maxSlots]);

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
        <h2 className="sheet-title">Pengaturan</h2>

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
          <label className="field-label">Tampilan</label>
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

        <div className="field" style={{ marginBottom: 4 }}>
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

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Batal</button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => onSave({ capital: Number(capitalInput) || capital, maxSlots: Number(slotsInput) || maxSlots })}
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
