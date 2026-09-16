import { useEffect, useState } from 'react';

// Real broker-summary/foreign-flow data (Index Alpha), public and paid for
// server-side via INDEXALPHA_API_KEY - no Google sign-in needed here, so
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
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}M`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}jt`;
  return `${sign}${new Intl.NumberFormat('id-ID').format(Math.round(abs))}`;
}

export default function BandarmologyPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [failed, setFailed] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [range, setRange] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch('/api/bandarmology');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Gagal memuat data (${res.status})`);
        if (cancelled) return;
        setResults(data.results || []);
        setFailed(data.failed || []);
        setGeneratedAt(data.generatedAt);
        setRange(data.range);
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
          Skor bandarmologi saham LQ45/IDX30 dari data broker summary &amp; foreign flow asli (Index Alpha), digabung
          jadi satu skor akumulasi/distribusi. Bukan rekomendasi atau ajakan membeli.
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
            Net foreign{' '}
            <span className={r.netForeign >= 0 ? 'text-success' : 'text-danger'}>
              {r.netForeign >= 0 ? '+' : ''}{formatRupiah(r.netForeign)}
            </span>
          </p>
          <p className="muted" style={{ marginTop: 2 }}>
            Broker dominan: {r.concentration >= 0 ? 'net buy' : 'net sell'} {r.concentration >= 0 ? r.topBuyerCode : r.topSellerCode}
            {' '}({r.concentration >= 0 ? '+' : ''}{(r.concentration * 100).toFixed(1)}% dari total nilai beli)
          </p>
        </div>
      ))}

      {!loading && failed.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Gagal dimuat: {failed.length} saham (data Index Alpha mungkin lagi bermasalah untuk sebagian kode).
        </p>
      )}

      {generatedAt && (
        <p className="muted" style={{ marginTop: 12, fontSize: 11 }}>
          Diperbarui {new Date(generatedAt).toLocaleString('id-ID')}
          {range && ` · Rentang ${range.from} s/d ${range.to}`}
        </p>
      )}
    </div>
  );
}
