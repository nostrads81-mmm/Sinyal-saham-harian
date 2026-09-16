import { useEffect, useState } from 'react';

// Public price/volume data only - no Google Sheets, no sign-in needed, so
// this page loads straight into the fetch instead of gating on a token
// like Sinyal/Rekapan/Watchlist do.

const VERDICT_BADGE = {
  'Akumulasi kuat': 'badge badge-success',
  Akumulasi: 'badge badge-success',
  Netral: 'badge',
  Distribusi: 'badge badge-danger',
  'Distribusi kuat': 'badge badge-danger',
};

function formatRupiah(n) {
  return new Intl.NumberFormat('id-ID').format(Math.round(n));
}

export default function BandarmologyPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [failed, setFailed] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch('/api/bandarmology');
        if (!res.ok) throw new Error(`Gagal memuat data (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        setResults(data.results || []);
        setFailed(data.failed || []);
        setGeneratedAt(data.generatedAt);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <div>
      <div className="page-header">
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <h1 className="page-title">Bandarmology</h1>
          <button className="btn icon-btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} aria-label="Muat ulang">
            &#8635;
          </button>
        </div>
        <p className="page-sub">
          Bukan bandarmologi asli (data broker tidak tersedia gratis) - ini proxy dari lonjakan volume + tren OBV/Akumulasi-Distribusi
          berbasis data harga publik saham LQ45/IDX30. Bukan rekomendasi atau ajakan membeli.
        </p>
      </div>

      {loading && <p className="muted">Memuat data...</p>}
      {error && <p className="muted text-danger">{error}</p>}

      {!loading && !error && results.length === 0 && (
        <p className="muted">Tidak ada data yang berhasil dimuat.</p>
      )}

      {!loading && !error && results.map((r) => (
        <div key={r.ticker} className="card">
          <div className="card-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
            <span className="ticker">{r.ticker}</span>
            <span className={VERDICT_BADGE[r.verdict] || 'badge'}>{r.verdict}</span>
          </div>
          <p className="muted" style={{ marginTop: 4 }}>
            Close {formatRupiah(r.lastClose)}{' '}
            <span className={r.changePercent >= 0 ? 'text-success' : 'text-danger'}>
              ({r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%)
            </span>
          </p>
          <p className="muted" style={{ marginTop: 2 }}>
            Volume {r.volumeRatio.toFixed(2)}x rata-rata 20 hari
          </p>
          <p className="muted" style={{ marginTop: 2 }}>
            Tren OBV {r.obvTrend >= 0 ? '+' : ''}{r.obvTrend.toFixed(2)} · Tren Akumulasi/Distribusi {r.adTrend >= 0 ? '+' : ''}{r.adTrend.toFixed(2)}
          </p>
        </div>
      ))}

      {!loading && failed.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Gagal dimuat: {failed.length} saham (data Yahoo Finance mungkin lagi bermasalah untuk sebagian kode).
        </p>
      )}

      {generatedAt && (
        <p className="muted" style={{ marginTop: 12, fontSize: 11 }}>
          Diperbarui {new Date(generatedAt).toLocaleString('id-ID')}
        </p>
      )}
    </div>
  );
}
