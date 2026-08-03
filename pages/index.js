import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken, signOut } from '../lib/auth';
import {
  getValues, appendValues, ensureSheetsInitialized, getSettings, getInvestedCapital, getJournaledStocks,
  APP_DATA_SHEET_ID, WATCHLIST_SHEET_ID, WATCHLIST_RANGE,
} from '../lib/sheets';
import { parseWatchlistRows, rankSignals, sortRunningSignals, positionSize, buildWaSignal, mergeSignalSources } from '../lib/scoring';
import { getWaSignals, addWaSignal, removeWaSignal, pruneStaleWaSignals } from '../lib/waSignals';

function formatRupiah(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

function todayDDMMYYYY() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildAiPrompt(signals) {
  const lines = signals.map((s) =>
    `${s.stock}: entry ${s.entry}, SL ${s.sl} (${s.slPercent.toFixed(2)}%), TP1 ${s.tp1} (${s.tp1Percent.toFixed(2)}%)`
  );
  return `Tolong analisa saham-saham berikut, kasih tau trennya kemana dan peluang naiknya:\n\n${lines.join('\n')}`;
}

export default function SinyalPage() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signals, setSignals] = useState([]);
  const [runningSignals, setRunningSignals] = useState([]);
  const [settings, setSettings] = useState(null);
  const [investedCapital, setInvestedCapital] = useState(0);
  const [journaledStocks, setJournaledStocks] = useState(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordingStock, setRecordingStock] = useState(null);
  const [fillPrice, setFillPrice] = useState('');
  const [fillLot, setFillLot] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const savingRef = useRef(false);

  const [waExtracting, setWaExtracting] = useState(false);
  const [waExtractError, setWaExtractError] = useState(null);
  const [waReview, setWaReview] = useState(null);
  const waPasteZoneRef = useRef(null);

  useEffect(() => {
    setToken(getStoredToken());
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
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await ensureSheetsInitialized(token);
        const [rawRows, settingsData, invested, journaled] = await Promise.all([
          getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token),
          getSettings(token),
          getInvestedCapital(token),
          getJournaledStocks(token),
        ]);
        if (cancelled) return;
        setSettings(settingsData);
        setInvestedCapital(invested);
        setJournaledStocks(journaled);
        const parsed = parseWatchlistRows(rawRows, { tradeType: 'DAY TRADE' });

        const waRaw = getWaSignals();
        const waBuilt = waRaw.map(buildWaSignal);
        const { combined, staleWaStocks } = mergeSignalSources(parsed, waBuilt);
        if (staleWaStocks.length > 0) pruneStaleWaSignals(staleWaStocks);

        const remainingCapital = Math.max(settingsData.capital - invested, 0);
        setSignals(rankSignals(combined, {
          capital: settingsData.capital, riskPercent: settingsData.riskPercent, remainingCapital,
        }));
        setRunningSignals(sortRunningSignals(parsed));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  function openRecordForm(s, pos) {
    setRecordingStock(s.stock);
    setFillPrice(String(s.entry));
    setFillLot(pos ? String(Math.round(pos.lembar / 100)) : '');
    setSaveError(null);
  }

  function closeRecordForm() {
    setRecordingStock(null);
    setSaveError(null);
  }

  async function submitRecord(s) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const row = [
        todayDDMMYYYY(), s.stock, Number(fillPrice) || s.entry, s.sl, s.tp1, s.tp2 || '',
        'RUNNING', '', '', `Lot: ${fillLot || '-'}`,
      ];
      await appendValues(APP_DATA_SHEET_ID, 'DayTrade_Journal!A:J', [row], token);
      setRecordingStock(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function processWaImage(file) {
    setWaExtracting(true);
    setWaExtractError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/extract-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: file.type, type: 'wa_signal' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membaca gambar');
      const onlyDayTrade = (data.signals || []).filter((s) => s.tradeType === 'DAY TRADE');
      setWaReview(onlyDayTrade);
    } catch (err) {
      setWaExtractError(err.message);
    } finally {
      setWaExtracting(false);
    }
  }

  function handleWaPasteZone(e) {
    e.preventDefault();
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (waPasteZoneRef.current) waPasteZoneRef.current.innerHTML = '';
    if (!item) return;
    const file = item.getAsFile();
    if (file) processWaImage(file);
  }

  // Ctrl+V anywhere on the Sinyal tab pastes a screenshot straight in,
  // no need to save the file first. Only active when not already busy/reviewing.
  useEffect(() => {
    if (!token || waReview !== null) return;
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) processWaImage(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [token, waReview]);

  function updateWaReviewField(index, field, value) {
    setWaReview((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function removeWaReviewRow(index) {
    setWaReview((prev) => prev.filter((_, i) => i !== index));
  }

  function confirmWaSignals() {
    for (const s of waReview) {
      addWaSignal({
        stock: s.stock,
        buyLow: Number(s.buyLow),
        buyHigh: Number(s.buyHigh),
        sl: Number(s.sl),
        tp1: Number(s.tp1),
        tp2: s.tp2 ? Number(s.tp2) : null,
        mmPercent: s.mmPercent ? Number(s.mmPercent) : null,
        capturedAt: new Date().toISOString(),
      });
    }
    setWaReview(null);
    setRefreshKey((k) => k + 1);
  }

  function copyAll() {
    const shown = signals.filter((s) => !s.willSkip);
    navigator.clipboard.writeText(buildAiPrompt(shown));
  }

  function copyOne(signal) {
    navigator.clipboard.writeText(buildAiPrompt([signal]));
  }

  if (!token) {
    return (
      <div className="center-box">
        <p>Masuk dengan akun Google (sigits81@gmail.com) untuk melihat sinyal hari ini.</p>
        <button className="btn btn-primary" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      </div>
    );
  }

  const remainingCapital = settings ? Math.max(settings.capital - investedCapital, 0) : null;
  // "Sinyal hari ini" = actionable (OPEN) AND published today; everything else
  // (older still-open signals + genuinely RUNNING ones) is grouped as "running".
  const mainSignals = signals.filter((s) => s.isActionable && s.ageDays === 0);
  const olderOpenSignals = signals.filter((s) => s.isActionable && s.ageDays !== 0);
  const allRunningSignals = [...olderOpenSignals, ...runningSignals];

  function renderCard(s) {
    const pos = settings ? positionSize(s.entry, s.sl, settings.capital, settings.riskPercent) : null;
    return (
      <div key={s.stock + s.status} className={`card ${s.willSkip ? 'skip-card' : ''}`}>
        <div className="card-row">
          <span style={{ fontSize: 15, fontWeight: 600 }}>{s.stock}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {s.source === 'wa' && <span className="badge" style={{ background: '#1f2a1c', color: '#8fd15c' }}>dari WA</span>}
            {s.willSkip ? (
              <span className="badge badge-warning">skip · modal habis</span>
            ) : (
              <span className="badge">skor {s.score.toFixed(2)}</span>
            )}
            {!s.willSkip && (
              <button className="btn" style={{ padding: '4px 8px' }} onClick={() => copyOne(s)}>
                copy
              </button>
            )}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 2 }}>
          {s.status}
          {s.isRunning && s.highestTpReached > 0 ? ` (TP${s.highestTpReached} sudah tercapai)` : ''}
          {s.ageDays !== null ? ` · ${s.ageDays === 0 ? 'baru hari ini' : `sejak ${s.ageDays} hari`}` : ''}
        </p>
        {s.waitFor && (
          <p className="muted">Tunggu turun ke {s.waitFor} sebelum entry</p>
        )}
        {s.estimatedEntry && (
          <p className="muted">Entry estimasi (tengah range) - cek harga live sebelum eksekusi</p>
        )}
        {(s.isRunning || !s.willSkip) && (
          <table className="data-table">
            <tbody>
              <tr>
                <td>Entry</td><td>SL</td><td>TP1</td><td>TP2</td><td>TP3</td>
                {!s.isRunning && <td style={{ textAlign: 'right' }}>Posisi</td>}
              </tr>
              <tr>
                <td className="value">{s.entry.toLocaleString('id-ID')}</td>
                <td className="value" style={{ color: '#ff6b6b' }}>{s.sl?.toLocaleString('id-ID')}</td>
                <td className="value" style={{ color: '#4fd07e' }}>{s.tp1?.toLocaleString('id-ID')}</td>
                <td className="value" style={{ color: '#4fd07e' }}>{s.tp2?.toLocaleString('id-ID') || '-'}</td>
                <td className="value" style={{ color: '#4fd07e' }}>{s.tp3?.toLocaleString('id-ID') || '-'}</td>
                {!s.isRunning && (
                  <td className="value" style={{ textAlign: 'right' }}>
                    {pos ? formatRupiah(pos.rupiah) : '-'}
                    {pos && <div className="muted" style={{ fontWeight: 400 }}>{Math.round(pos.lembar / 100)} lot</div>}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        )}

        {!s.isRunning && !s.willSkip && recordingStock !== s.stock && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => openRecordForm(s, pos)}
              disabled={journaledStocks.has(s.stock.toUpperCase())}
            >
              {journaledStocks.has(s.stock.toUpperCase()) ? 'Sudah tercatat di jurnal' : 'Sudah beli, catat ke jurnal'}
            </button>
            {s.source === 'wa' && (
              <button
                className="btn"
                onClick={() => { removeWaSignal(s.stock); setRefreshKey((k) => k + 1); }}
              >
                hapus
              </button>
            )}
          </div>
        )}

        {recordingStock === s.stock && (
          <div style={{ marginTop: 8, borderTop: '1px solid #262832', paddingTop: 8 }}>
            <p className="muted" style={{ marginBottom: 4 }}>Harga beli aktual</p>
            <input
              type="number"
              value={fillPrice}
              onChange={(e) => setFillPrice(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <p className="muted" style={{ marginBottom: 4 }}>Jumlah (lot)</p>
            <input
              type="number"
              value={fillLot}
              onChange={(e) => setFillLot(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {saveError && <p className="muted" style={{ color: '#ff6b6b' }}>{saveError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={closeRecordForm} disabled={saving}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => submitRecord(s)}
                disabled={saving}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (waReview !== null) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Review sinyal WA</h1>
          <p className="page-sub">Periksa dulu angkanya sebelum ditambahkan</p>
        </div>

        {waReview.length === 0 && (
          <p className="muted">Tidak ada sinyal DAY TRADE yang terbaca dari screenshot ini.</p>
        )}

        {waReview.map((s, i) => (
          <div key={i} className="card">
            <div className="card-row">
              <input
                value={s.stock}
                onChange={(e) => updateWaReviewField(i, 'stock', e.target.value)}
                style={{ width: '40%', fontWeight: 600 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.confidence === 'low' && <span className="badge badge-warning">cek lagi</span>}
                <button className="btn" style={{ padding: '4px 8px' }} onClick={() => removeWaReviewRow(i)}>hapus</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Buy low</p>
                <input type="number" value={s.buyLow} onChange={(e) => updateWaReviewField(i, 'buyLow', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Buy high</p>
                <input type="number" value={s.buyHigh} onChange={(e) => updateWaReviewField(i, 'buyHigh', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>SL</p>
                <input type="number" value={s.sl} onChange={(e) => updateWaReviewField(i, 'sl', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>TP1</p>
                <input type="number" value={s.tp1} onChange={(e) => updateWaReviewField(i, 'tp1', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>TP2 (opsional)</p>
                <input type="number" value={s.tp2 || ''} onChange={(e) => updateWaReviewField(i, 'tp2', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>MM %</p>
                <input type="number" value={s.mmPercent || ''} onChange={(e) => updateWaReviewField(i, 'mmPercent', e.target.value)} />
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setWaReview(null)}>Batal</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmWaSignals} disabled={waReview.length === 0}>
            Tambahkan ke daftar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header card-row">
        <div>
          <h1 className="page-title">Sinyal Saham Harian</h1>
          <p className="page-sub">
            {settings ? `Sisa modal: ${formatRupiah(remainingCapital)} dari ${formatRupiah(settings.capital)}` : '...'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} aria-label="Refresh">
            &#8635;
          </button>
          <button className="btn" onClick={copyAll}>Copy semua</button>
        </div>
      </div>

      <div
        ref={waPasteZoneRef}
        contentEditable
        suppressContentEditableWarning
        onPaste={handleWaPasteZone}
        style={{
          background: '#fff', border: '1.5px dashed #b9c4e0', borderRadius: 14, padding: '18px 14px', marginBottom: 12,
          color: '#4a5170', fontSize: 14, fontWeight: 500, outline: 'none', minHeight: 20, textAlign: 'center',
        }}
      >
        {waExtracting ? 'Membaca screenshot WA...' : '📋 Tambah sinyal dari WA'}
      </div>
      {waExtractError && <p className="muted" style={{ color: '#ff6b6b' }}>{waExtractError}</p>}

      {loading && <p className="muted">Memuat sinyal...</p>}
      {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}

      {!loading && signals.length === 0 && !error && (
        <p className="muted">Tidak ada sinyal DAY TRADE aktif saat ini.</p>
      )}

      <p style={{ marginTop: 8, marginBottom: 8, fontWeight: 600 }}>Sinyal hari ini ({mainSignals.length})</p>
      {mainSignals.map(renderCard)}

      {allRunningSignals.length > 0 && (
        <>
          <p style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>
            Sinyal running ({allRunningSignals.length})
          </p>
          {allRunningSignals.map(renderCard)}
        </>
      )}

      <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={signOut}>
        Keluar
      </button>
    </div>
  );
}
