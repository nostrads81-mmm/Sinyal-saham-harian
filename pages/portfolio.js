import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import { getPortfolioLatest, savePortfolio } from '../lib/sheets';

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
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PortfolioPage() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [review, setReview] = useState(null); // holdings array while editing, or null
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fileInputRef = useRef(null);

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
        const data = await getPortfolioLatest(token);
        if (!cancelled) setHoldings(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  async function processPortfolioImage(file) {
    setExtracting(true);
    setExtractError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch('/api/extract-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membaca gambar');
      setReview(data.holdings || []);
    } catch (e) {
      setExtractError(e.message);
    } finally {
      setExtracting(false);
    }
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processPortfolioImage(file);
  }

  useEffect(() => {
    if (!token || review !== null) return;
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) processPortfolioImage(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [token, review]);

  function updateReviewField(index, field, value) {
    setReview((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  }

  function removeReviewRow(index) {
    setReview((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirmSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const cleaned = review.map((h) => ({
        symbol: String(h.symbol).toUpperCase().trim(),
        avgPrice: Number(h.avgPrice) || 0,
        qtyLot: Number(h.qtyLot) || 0,
        currentPrice: Number(h.currentPrice) || 0,
      })).filter((h) => h.symbol);
      await savePortfolio(token, cleaned, todayDDMMYYYY());
      setReview(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setExtractError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="center-box">
        <p>Masuk dengan akun Google untuk melihat portofolio.</p>
        <button className="btn btn-primary" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      </div>
    );
  }

  const totalEquity = holdings.reduce((sum, h) => sum + h.currentPrice * h.qtyLot * 100, 0);
  const totalModal = holdings.reduce((sum, h) => sum + h.avgPrice * h.qtyLot * 100, 0);
  const totalPnl = totalEquity - totalModal;

  // ---- Review screen ----
  if (review !== null) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Review hasil baca</h1>
          <p className="page-sub">Periksa dulu angkanya sebelum disimpan</p>
        </div>

        <div style={{
          background: '#3a2a10', color: '#f0b840', fontSize: 12, padding: '8px 10px',
          borderRadius: 8, marginBottom: 12,
        }}>
          Periksa dulu angkanya, AI kadang salah baca satu-dua digit.
        </div>

        {review.map((h, i) => (
          <div key={i} className={`card ${h.confidence === 'low' ? '' : ''}`} style={h.confidence === 'low' ? { border: '1px solid #f0b840' } : undefined}>
            <div className="card-row">
              <input
                value={h.symbol}
                onChange={(e) => updateReviewField(i, 'symbol', e.target.value)}
                style={{ width: '40%', fontWeight: 600 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {h.confidence === 'low' && <span className="badge badge-warning">cek lagi</span>}
                <button className="btn" style={{ padding: '4px 8px' }} onClick={() => removeReviewRow(i)}>hapus</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Avg price</p>
                <input type="number" value={h.avgPrice} onChange={(e) => updateReviewField(i, 'avgPrice', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Qty (lot)</p>
                <input type="number" value={h.qtyLot} onChange={(e) => updateReviewField(i, 'qtyLot', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Harga sekarang</p>
                <input type="number" value={h.currentPrice} onChange={(e) => updateReviewField(i, 'currentPrice', e.target.value)} />
              </div>
            </div>
          </div>
        ))}

        {extractError && <p className="muted" style={{ color: '#ff6b6b' }}>{extractError}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setReview(null)} disabled={saving}>
            Batal
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Main portfolio screen ----
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Portofolio</h1>
        <p className="page-sub">
          {holdings[0]?.updatedAt ? `Terakhir update: ${holdings[0].updatedAt}` : 'Belum ada data'}
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Total ekuitas</div>
          <div className="stat-value">{formatRupiah(totalEquity)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">P&L</div>
          <div className="stat-value" style={{ color: totalPnl >= 0 ? '#4fd07e' : '#ff6b6b' }}>
            {totalPnl >= 0 ? '+' : ''}{formatRupiah(totalPnl)}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      <button
        className="btn btn-primary"
        style={{ width: '100%', marginBottom: 12 }}
        onClick={() => fileInputRef.current?.click()}
        disabled={extracting}
      >
        {extracting ? 'Membaca gambar...' : 'Upload screenshot'}
      </button>
      <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
        atau tempel (Ctrl+V) screenshot langsung di halaman ini
      </p>
      {extractError && <p className="muted" style={{ color: '#ff6b6b' }}>{extractError}</p>}

      {loading && <p className="muted">Memuat portofolio...</p>}
      {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      {!loading && holdings.length === 0 && !error && (
        <p className="muted">Belum ada data portofolio. Upload screenshot buat mulai.</p>
      )}

      {holdings.map((h, i) => {
        const pnlPercent = h.avgPrice ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
        return (
          <div key={i} className="card">
            <div className="card-row">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{h.symbol}</span>
              <span className={pnlPercent >= 0 ? 'badge badge-success' : 'badge badge-danger'}>
                {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
              </span>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>
              {h.qtyLot} lot &middot; avg {h.avgPrice?.toLocaleString('id-ID')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
