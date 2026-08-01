import { useEffect, useState } from 'react';
import { getAccessToken, getStoredToken, signOut } from '../lib/auth';
import {
  getValues, ensureSheetsInitialized, getSettings, getActiveJournalCount,
  WATCHLIST_SHEET_ID, WATCHLIST_RANGE,
} from '../lib/sheets';
import { parseWatchlistRows, rankSignals, positionSize } from '../lib/scoring';

function formatRupiah(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
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
  const [settings, setSettings] = useState(null);
  const [heldCount, setHeldCount] = useState(0);

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
        const [rawRows, settingsData, held] = await Promise.all([
          getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token),
          getSettings(token),
          getActiveJournalCount(token),
        ]);
        if (cancelled) return;
        setSettings(settingsData);
        setHeldCount(held);
        const parsed = parseWatchlistRows(rawRows, { tradeType: 'DAY TRADE' });
        const openSlots = Math.max(settingsData.maxSlots - held, 0);
        setSignals(rankSignals(parsed, { openSlots }));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

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

  const openSlots = settings ? Math.max(settings.maxSlots - heldCount, 0) : null;

  return (
    <div>
      <div className="page-header card-row">
        <div>
          <h1 className="page-title">Sinyal hari ini</h1>
          <p className="page-sub">
            {settings ? `Sisa slot: ${openSlots} dari ${settings.maxSlots}` : '...'}
          </p>
        </div>
        <button className="btn" onClick={copyAll}>Copy semua</button>
      </div>

      {loading && <p className="muted">Memuat sinyal...</p>}
      {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}

      {!loading && signals.length === 0 && !error && (
        <p className="muted">Tidak ada sinyal DAY TRADE aktif saat ini.</p>
      )}

      {signals.map((s) => {
        const pos = settings ? positionSize(s.entry, s.sl, settings.capital, settings.riskPercent) : null;
        return (
          <div key={s.stock + s.rank} className={`card ${s.willSkip ? 'skip-card' : ''}`}>
            <div className="card-row">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{s.stock}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {s.willSkip ? (
                  <span className="badge badge-warning">skip &middot; slot penuh</span>
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
              {s.status}{s.ageDays !== null ? ` · ${s.ageDays === 0 ? 'baru hari ini' : `sejak ${s.ageDays} hari`}` : ''}
            </p>
            {s.waitFor && (
              <p className="muted">Tunggu turun ke {s.waitFor} sebelum entry</p>
            )}
            {!s.willSkip && (
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>Entry</td><td>SL</td><td>TP1</td><td style={{ textAlign: 'right' }}>Posisi</td>
                  </tr>
                  <tr>
                    <td className="value">{s.entry.toLocaleString('id-ID')}</td>
                    <td className="value" style={{ color: '#ff6b6b' }}>{s.sl?.toLocaleString('id-ID')}</td>
                    <td className="value" style={{ color: '#4fd07e' }}>{s.tp1?.toLocaleString('id-ID')}</td>
                    <td className="value" style={{ textAlign: 'right' }}>{pos ? formatRupiah(pos.rupiah) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={signOut}>
        Keluar
      </button>
    </div>
  );
}
