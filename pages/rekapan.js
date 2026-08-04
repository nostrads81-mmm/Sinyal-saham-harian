import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import { getJournalEntries, closeJournalEntry, getSettings, ensureSheetsInitialized } from '../lib/sheets';

function todayDDMMYYYY() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatRupiah(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

// Catatan stores "Lot: 31" (set when recording the trade from Tab Sinyal).
function parseLot(catatan) {
  const match = String(catatan || '').match(/Lot:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

// Net P&L after Stockbit's buy/sell fees and stamp duty (materai) - not just
// the raw price difference. Falls back to a fee-free estimate when the lot
// wasn't recorded (older entries from before this was tracked).
function computeNetPnl(entry, exit, lot, settings) {
  if (!entry || !exit) return null;
  const shares = lot * 100;
  if (shares <= 0) {
    return { pnlRp: null, pnlPercent: ((exit - entry) / entry) * 100, estimated: true };
  }
  const buyValue = entry * shares;
  const sellValue = exit * shares;
  const buyMateraiHit = buyValue > settings.materaiThreshold ? settings.materaiAmount : 0;
  const sellMateraiHit = sellValue > settings.materaiThreshold ? settings.materaiAmount : 0;
  const buyCost = buyValue * (1 + settings.buyFeePercent) + buyMateraiHit;
  const sellProceeds = sellValue * (1 - settings.sellFeePercent) - sellMateraiHit;
  const pnlRp = sellProceeds - buyCost;
  return { pnlRp, pnlPercent: (pnlRp / buyCost) * 100, estimated: false };
}

const STATUS_BADGE = {
  RUNNING: { cls: 'badge', label: 'running' },
  OPEN: { cls: 'badge', label: 'open' },
  'CLOSE-PROFIT': { cls: 'badge badge-success', label: 'profit' },
  'CLOSE-LOSS': { cls: 'badge badge-danger', label: 'loss' },
  SKIP: { cls: 'badge badge-warning', label: 'skip' },
};

export default function RekapanPage() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [closingRow, setClosingRow] = useState(null);
  const [exitPrice, setExitPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
        const [data, settingsData] = await Promise.all([
          getJournalEntries(token),
          getSettings(token),
        ]);
        if (cancelled) return;
        setEntries(data.reverse());
        setSettings(settingsData);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  function openCloseForm(entry) {
    setClosingRow(entry.rowNumber);
    setExitPrice(entry.tp1 ? String(entry.tp1) : '');
  }

  async function submitClose(entry) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const exit = Number(exitPrice);
      const lot = parseLot(entry.catatan);
      const net = computeNetPnl(entry.entry, exit, lot, settings);
      const status = net.pnlPercent >= 0 ? 'CLOSE-PROFIT' : 'CLOSE-LOSS';
      await closeJournalEntry(token, entry.rowNumber, {
        tanggalExit: `'${todayDDMMYYYY()}`,
        hargaExit: exit,
        status,
      });
      setClosingRow(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="center-box">
        <p>Masuk dengan akun Google untuk melihat rekapan.</p>
        <button className="btn btn-primary" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      </div>
    );
  }

  const closed = settings ? entries.filter((e) => e.status.startsWith('CLOSE')) : [];
  const closedNet = closed.map((e) => computeNetPnl(e.entry, e.hargaExit, parseLot(e.catatan), settings));
  const wins = closedNet.filter((n) => n && n.pnlPercent >= 0).length;
  const losses = closedNet.filter((n) => n && n.pnlPercent < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const totalPnlRp = closedNet.reduce((sum, n) => sum + (n?.pnlRp || 0), 0);
  const totalPnlPercent = closedNet.reduce((sum, n) => sum + (n?.pnlPercent || 0), 0);
  const anyEstimated = closedNet.some((n) => n?.estimated);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rekapan</h1>
        <p className="page-sub">Jurnal day trade &middot; P&amp;L sudah dikurangi fee &amp; materai</p>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Win rate</div>
          <div className="stat-value" style={{ color: '#4fd07e' }}>
            {winRate !== null ? `${winRate.toFixed(1)}%` : '-'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Total P&L bersih</div>
          <div className="stat-value" style={{ color: totalPnlRp >= 0 ? '#4fd07e' : '#ff6b6b', fontSize: 16 }}>
            {closed.length > 0 ? `${totalPnlRp >= 0 ? '+' : ''}${formatRupiah(totalPnlRp)}` : '-'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Menang</div>
          <div className="stat-value">{wins}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Kalah</div>
          <div className="stat-value">{losses}</div>
        </div>
      </div>
      {closed.length > 0 && (
        <p className="muted" style={{ marginTop: -10, marginBottom: 12 }}>
          Total P&amp;L% bersih: {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
          {anyEstimated ? ' (sebagian estimasi - lot tidak tercatat)' : ''}
        </p>
      )}

      {loading && <p className="muted">Memuat jurnal...</p>}
      {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      {!loading && entries.length === 0 && !error && (
        <p className="muted">Belum ada transaksi tercatat. Catat dari Tab Sinyal setelah beli.</p>
      )}

      {settings && entries.map((e) => {
        const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
        const lot = parseLot(e.catatan);
        const net = e.hargaExit ? computeNetPnl(e.entry, e.hargaExit, lot, settings) : null;
        const isRunning = e.status === 'RUNNING' || e.status === 'OPEN';
        return (
          <div key={e.rowNumber} className="card">
            <div className="card-row">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{e.stock}</span>
              <span className={badge.cls}>
                {net ? `${net.pnlPercent >= 0 ? '+' : ''}${net.pnlPercent.toFixed(2)}%` : badge.label}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>
              Entry {e.entry?.toLocaleString('id-ID')} &middot; {lot ? `${lot} lot` : '- lot'}
              {e.tanggalExit ? ` → exit ${e.tanggalExit}` : ''}
            </p>
            {net && !net.estimated && (
              <p className="muted" style={{ marginTop: 2, color: net.pnlRp >= 0 ? '#4fd07e' : '#ff6b6b' }}>
                {net.pnlRp >= 0 ? '+' : ''}{formatRupiah(net.pnlRp)} bersih (sudah dikurangi fee &amp; materai)
              </p>
            )}
            <p className="muted" style={{ marginTop: 2 }}>
              SL <span style={{ color: '#ff6b6b' }}>{e.sl?.toLocaleString('id-ID') || '-'}</span>
              {' · '}TP1 <span style={{ color: '#4fd07e' }}>{e.tp1?.toLocaleString('id-ID') || '-'}</span>
              {e.tp2 ? <> {' · '}TP2 <span style={{ color: '#4fd07e' }}>{e.tp2.toLocaleString('id-ID')}</span></> : null}
            </p>

            {isRunning && closingRow !== e.rowNumber && (
              <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => openCloseForm(e)}>
                Tutup posisi
              </button>
            )}

            {closingRow === e.rowNumber && (
              <div style={{ marginTop: 8, borderTop: '1px solid #262832', paddingTop: 8 }}>
                <p className="muted" style={{ marginBottom: 4 }}>Harga exit</p>
                <input
                  type="number"
                  value={exitPrice}
                  onChange={(ev) => setExitPrice(ev.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setClosingRow(null)} disabled={saving}>
                    Batal
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => submitClose(e)}
                    disabled={saving || !exitPrice}
                  >
                    {saving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
