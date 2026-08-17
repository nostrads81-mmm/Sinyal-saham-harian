import { useEffect, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import { getValues, WATCHLIST_SHEET_ID, WATCHLIST_RANGE } from '../lib/sheets';
import { parseWatchlistRowsRaw } from '../lib/scoring';

const STATUS_BADGE = {
  RUNNING: { cls: 'badge badge-success', label: 'running' },
  OPEN: { cls: 'badge', label: 'open' },
  PENDING: { cls: 'badge badge-warning', label: 'pending' },
};

// "-" is the source sheet's own empty-cell placeholder (e.g. a DAY TRADE
// row with no TP2/TP3) - treat that the same as a blank cell.
const has = (v) => v && v !== '-';

// Same style/intent as the "copy" prompt on the Sinyal tab (see
// buildAiPrompt in pages/index.js) - range + a question about where to
// enter, since these rows don't carry a pre-computed entry estimate like
// Sinyal's WA-sourced signals do.
function buildAiPrompt(rows) {
  const lines = rows.map((r) => {
    const parts = [`range beli ${has(r.buyPrice) ? r.buyPrice : '-'}`];
    if (has(r.sl)) parts.push(`SL ${r.sl}`);
    if (has(r.tp1)) parts.push(`TP1 ${r.tp1}`);
    if (has(r.tp2)) parts.push(`TP2 ${r.tp2}`);
    if (has(r.tp3)) parts.push(`TP3 ${r.tp3}`);
    return `${r.stock}: ${parts.join(', ')}`;
  });
  return `Tolong analisa saham-saham berikut, kasih tau trennya kemana, peluang naiknya, dan menurut kamu sebaiknya entry di harga berapa dari range yang tersedia:\n\n${lines.join('\n')}`;
}

export default function WatchlistPage() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

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
        const rawRows = await getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token);
        if (cancelled) return;
        setRows(parseWatchlistRowsRaw(rawRows));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  if (!token) {
    return (
      <div className="center-box">
        <div className="login-icon">📈</div>
        <h1 className="login-title">Watchlist</h1>
        <p className="login-sub">Masuk dengan akun Google untuk melihat data watchlist.</p>
        <button className="btn btn-primary login-btn" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted text-danger" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const dayTradeRows = rows.filter((r) => r.tradeType === 'DAY TRADE');
  const swingTradeRows = rows.filter((r) => r.tradeType === 'SWING TRADE');
  const otherRows = rows.filter((r) => r.tradeType !== 'DAY TRADE' && r.tradeType !== 'SWING TRADE');

  function copyRow(r) {
    navigator.clipboard.writeText(buildAiPrompt([r]));
  }

  function renderRow(r) {
    const badge = STATUS_BADGE[r.status] || (r.status ? { cls: 'badge', label: r.status.toLowerCase() } : null);
    return (
      <div key={`${r.stock}-${r.date}`} className="card">
        <div className="card-row">
          <span className="ticker">{r.stock}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {badge && <span className={badge.cls}>{badge.label}</span>}
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => copyRow(r)}>
              copy
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{r.date}</p>
        <p className="muted" style={{ marginTop: 2 }}>
          Buy {has(r.buyPrice) ? r.buyPrice : '-'}{has(r.lastPrice) && ` · Last ${r.lastPrice}`}
        </p>
        <p className="muted" style={{ marginTop: 2 }}>
          SL <span className="text-danger">{has(r.sl) ? r.sl : '-'}</span>
          {has(r.tp1) && <> {' · '}TP1 <span className="text-success">{r.tp1}</span></>}
          {has(r.tp2) && <> {' · '}TP2 <span className="text-success">{r.tp2}</span></>}
          {has(r.tp3) && <> {' · '}TP3 <span className="text-success">{r.tp3}</span></>}
        </p>
        {r.detailStatus && <p className="muted" style={{ marginTop: 2 }}>{r.detailStatus}</p>}
        {r.mmPercent && <p className="muted" style={{ marginTop: 2 }}>MM: {r.mmPercent}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <h1 className="page-title">Watchlist</h1>
          <button className="btn icon-btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} aria-label="Muat ulang">
            &#8635;
          </button>
        </div>
        <p className="page-sub">
          Data mentah dari sheet sumber - cuma buat dilihat, tidak memengaruhi Sinyal.
        </p>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {error && <p className="muted text-danger">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="muted">Tidak ada data di watchlist.</p>
      )}

      {dayTradeRows.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 10px' }}>Day Trade</h2>
          {dayTradeRows.map(renderRow)}
        </>
      )}

      {swingTradeRows.length > 0 && (
        <>
          <h2 style={{ margin: '16px 0 10px' }}>Swing Trade</h2>
          {swingTradeRows.map(renderRow)}
        </>
      )}

      {otherRows.length > 0 && (
        <>
          <h2 style={{ margin: '16px 0 10px' }}>Lainnya</h2>
          {otherRows.map(renderRow)}
        </>
      )}
    </div>
  );
}
