import { useEffect, useState } from 'react';
import { getAccessToken, resolveInitialToken } from '../lib/auth';
import {
  getOrCreateAppDataSheetId, ensureSheetsInitialized, getSettings,
  getCalculatorHistory, addCalculatorEntry, deleteCalculatorEntry,
} from '../lib/sheets';
import { computeCalculator } from '../lib/calculator';
import { parseHargaInput } from '../lib/journalInput';
import { formatRupiah, todayDDMMYYYY } from '../lib/format';

export default function KalkulatorPage() {
  const [token, setToken] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [simbolInput, setSimbolInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [maksKerugianInput, setMaksKerugianInput] = useState('');
  const [result, setResult] = useState(null);
  const [calcError, setCalcError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingRow, setDeletingRow] = useState(null);
  // Riwayat stays hidden by default, same as "Sudah terjual" di Rekapan -
  // most visits are here to run one calculation, not to browse old ones.
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveInitialToken().then((t) => {
      if (cancelled) return;
      setToken(t);
      setCheckingAuth(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleSignIn() {
    setError(null);
    try {
      const t = await getAccessToken();
      setToken(t);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const resolvedSheetId = await getOrCreateAppDataSheetId(token);
        if (cancelled) return;
        setSheetId(resolvedSheetId);
        await ensureSheetsInitialized(token, resolvedSheetId);
        const [settingsData, historyData] = await Promise.all([
          getSettings(token, resolvedSheetId),
          getCalculatorHistory(token, resolvedSheetId),
        ]);
        if (cancelled) return;
        setSettings(settingsData);
        setHistory(historyData.reverse());
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  function parseInputs() {
    const entry = parseHargaInput(entryInput);
    const sl = parseHargaInput(slInput);
    const tp = parseHargaInput(tpInput);
    const maksKerugian = parseHargaInput(maksKerugianInput);
    if (entry.error || entry.value === null) return { error: entry.error || 'Entry wajib diisi' };
    if (sl.error || sl.value === null) return { error: sl.error || 'SL wajib diisi' };
    if (tp.error) return { error: tp.error };
    if (maksKerugian.error || maksKerugian.value === null) {
      return { error: maksKerugian.error || 'Maks kerugian wajib diisi' };
    }
    return { entry: entry.value, sl: sl.value, tp: tp.value, maksKerugian: maksKerugian.value };
  }

  // Editing any input after a calculation invalidates both the shown result
  // and any error message - without this, changing a field post-error left
  // a now-stale "Maks kerugian terlalu kecil" message on screen even once
  // the numbers no longer actually produced that error.
  function clearResult() {
    setCalcError(null);
    setResult(null);
  }

  function handleHitung() {
    clearResult();
    if (!settings) {
      setCalcError('Pengaturan belum selesai dimuat, coba lagi sebentar.');
      return;
    }
    const parsed = parseInputs();
    if (parsed.error) {
      setCalcError(parsed.error);
      return;
    }
    if (parsed.sl >= parsed.entry) {
      setCalcError('SL harus lebih kecil dari Entry.');
      return;
    }
    const computed = computeCalculator(parsed, settings);
    if (!computed || computed.lot <= 0) {
      setCalcError('Maks kerugian terlalu kecil untuk membeli 1 lot di harga entry ini.');
      return;
    }
    setResult({ ...parsed, ...computed });
  }

  async function handleSimpan() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      await addCalculatorEntry(token, sheetId, {
        tanggal: `'${todayDDMMYYYY()}`,
        simbol: simbolInput.trim().toUpperCase() || '-',
        entry: result.entry,
        sl: result.sl,
        tp: result.tp,
        maksKerugian: result.maksKerugian,
        lot: result.lot,
        rupiahBeli: result.rupiahBeli,
        estimasiTp: result.tpEstimate?.pnlRp ?? null,
        estimasiSl: result.slEstimate?.pnlRp ?? null,
      });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteHistory(row) {
    if (!window.confirm(`Hapus riwayat ${row.simbol} dari ${row.tanggal.replace(/^'/, '')}?`)) return;
    setDeletingRow(row.rowNumber);
    try {
      await deleteCalculatorEntry(token, sheetId, row.rowNumber);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingRow(null);
    }
  }

  if (!token) {
    if (checkingAuth) {
      return (
        <div className="center-box">
          <div className="login-icon">🧮</div>
          <p className="muted">Memeriksa sesi Google...</p>
        </div>
      );
    }
    return (
      <div className="center-box">
        <div className="login-icon">🧮</div>
        <h1 className="login-title">Kalkulator</h1>
        <p className="login-sub">Masuk dengan akun Google untuk pakai kalkulator posisi.</p>
        <button className="btn btn-primary login-btn" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted text-danger" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header card-row">
        <div>
          <h1 className="page-title">Kalkulator</h1>
          <p className="page-sub">Hitung lot &amp; nilai posisi dari batas maks kerugian</p>
        </div>
      </div>

      {error && <p className="muted text-danger">{error}</p>}

      <div className="card">
        <div className="field">
          <label className="field-label">Nama Saham</label>
          <input
            type="text"
            placeholder="mis. BBCA"
            value={simbolInput}
            onChange={(e) => setSimbolInput(e.target.value.toUpperCase())}
          />
        </div>
        <div className="field">
          <label className="field-label">Harga Entry</label>
          <input type="number" value={entryInput} onChange={(e) => { setEntryInput(e.target.value); clearResult(); }} />
        </div>
        <div className="field">
          <label className="field-label">Harga TP</label>
          <input type="number" value={tpInput} onChange={(e) => { setTpInput(e.target.value); clearResult(); }} />
        </div>
        <div className="field">
          <label className="field-label">Harga SL</label>
          <input type="number" value={slInput} onChange={(e) => { setSlInput(e.target.value); clearResult(); }} />
        </div>
        <div className="field">
          <label className="field-label">Maks Kerugian (Rp)</label>
          <input
            type="number"
            value={maksKerugianInput}
            onChange={(e) => { setMaksKerugianInput(e.target.value); clearResult(); }}
          />
          <p className="field-hint">
            Rupiah maksimal yang mau dirisikokan kalau harga kena SL - dari sini jumlah lot dihitung otomatis.
          </p>
        </div>

        {calcError && <p className="muted text-danger" style={{ marginTop: 4 }}>{calcError}</p>}

        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={handleHitung}>
          Hitung
        </button>

        {result && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div className="metric-grid">
              <div className="metric-cell">
                <span className="metric-label">Lot</span>
                <div className="metric-value">{result.lot.toLocaleString('id-ID')}</div>
              </div>
              <div className="metric-cell">
                <span className="metric-label">Nilai Beli</span>
                <div className="metric-value">{formatRupiah(result.rupiahBeli)}</div>
              </div>
              <div className="metric-cell">
                <span className="metric-label">Risiko</span>
                <div className="metric-value text-danger">{formatRupiah(result.maksKerugian)}</div>
              </div>
            </div>
            <p className="pb-row" style={{ marginTop: 8 }}>
              <span className="muted">Estimasi TP</span>
              <span className={result.tpEstimate && result.tpEstimate.pnlRp >= 0 ? 'text-success' : 'muted'}>
                {result.tpEstimate
                  ? `${result.tpEstimate.pnlRp >= 0 ? '+' : ''}${formatRupiah(result.tpEstimate.pnlRp)}`
                  : '- (TP tidak diisi)'}
              </span>
            </p>
            <p className="pb-row" style={{ marginTop: 4 }}>
              <span className="muted">Estimasi SL</span>
              <span className="text-danger">
                {result.slEstimate.pnlRp >= 0 ? '+' : ''}{formatRupiah(result.slEstimate.pnlRp)}
              </span>
            </p>
            <button
              type="button"
              className="btn"
              style={{ width: '100%', marginTop: 10 }}
              onClick={handleSimpan}
              disabled={saving}
            >
              {saving ? 'Menyimpan...' : 'Simpan ke Riwayat'}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="card-row"
        style={{
          width: '100%', background: 'none', border: 'none', padding: 0, marginTop: 16, marginBottom: 8, cursor: 'pointer',
          font: 'inherit', color: 'inherit', textAlign: 'left',
        }}
        onClick={() => setShowHistory((v) => !v)}
      >
        <span style={{ fontWeight: 600 }}>Riwayat ({history.length})</span>
        <span className="muted">{showHistory ? 'Sembunyikan ▴' : 'Tampilkan ▾'}</span>
      </button>

      {showHistory && history.length === 0 && (
        <p className="muted">Belum ada riwayat tersimpan.</p>
      )}

      {showHistory && history.map((row) => (
        <div key={row.rowNumber} className="card signal-card">
          <div className="signal-head">
            <span className="signal-head-left">
              <span className="ticker">{row.simbol}</span>
            </span>
            <span className="muted">{row.tanggal?.replace(/^'/, '')}</span>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            Entry {row.entry.toLocaleString('id-ID')}
            {row.tp ? ` · TP ${row.tp.toLocaleString('id-ID')}` : ''}
            {' · SL '}{row.sl.toLocaleString('id-ID')}
            {' · '}{row.lot.toLocaleString('id-ID')} lot
          </p>
          <p className="muted" style={{ marginTop: 2 }}>
            Beli {formatRupiah(row.rupiahBeli)}
            {row.estimasiTp != null && (
              <> · TP <span className="text-success">+{formatRupiah(row.estimasiTp)}</span></>
            )}
            {row.estimasiSl != null && (
              <> · SL <span className="text-danger">{formatRupiah(row.estimasiSl)}</span></>
            )}
          </p>
          <div className="card-actions">
            <button
              type="button"
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => handleDeleteHistory(row)}
              disabled={deletingRow === row.rowNumber}
            >
              {deletingRow === row.rowNumber ? 'Menghapus...' : 'Hapus'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
