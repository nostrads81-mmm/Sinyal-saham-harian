import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import { getJournalEntries, closeJournalEntry } from '../lib/sheets';

function todayDDMMYYYY() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function pnlPercent(entry, exit) {
  if (!entry || !exit) return null;
  return ((exit - entry) / entry) * 100;
}

// Catatan stores "Lot: 31" (set when recording the trade from Tab Sinyal).
function parseLot(catatan) {
  const match = String(catatan || '').match(/Lot:\s*(\d+)/i);
  return match ? match[1] : null;
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
        const data = await getJournalEntries(token);
        if (!cancelled) setEntries(data.reverse());
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
      const pnl = pnlPercent(entry.entry, exit);
      const status = pnl >= 0 ? 'CLOSE-PROFIT' : 'CLOSE-LOSS';
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

  const closed = entries.filter((e) => e.status.startsWith('CLOSE'));
  const wins = closed.filter((e) => e.status === 'CLOSE-PROFIT').length;
  const losses = closed.filter((e) => e.status === 'CLOSE-LOSS').length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const totalPnlPercent = closed.reduce((sum, e) => sum + (pnlPercent(e.entry, e.hargaExit) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rekapan</h1>
        <p className="page-sub">Jurnal day trade</p>
      </div>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Win rate</div>
          <div className="stat-value" style={{ color: '#4fd07e' }}>
            {winRate !== null ? `${winRate.toFixed(1)}%` : '-'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Total P&L%</div>
          <div className="stat-value" style={{ color: totalPnlPercent >= 0 ? '#4fd07e' : '#ff6b6b' }}>
            {closed.length > 0 ? `${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(2)}%` : '-'}
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

      {loading && <p className="muted">Memuat jurnal...</p>}
      {error && <p className="muted" style={{ color: '#ff6b6b' }}>{error}</p>}
      {!loading && entries.length === 0 && !error && (
        <p className="muted">Belum ada transaksi tercatat. Catat dari Tab Sinyal setelah beli.</p>
      )}

      {entries.map((e) => {
        const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
        const pnl = e.hargaExit ? pnlPercent(e.entry, e.hargaExit) : null;
        const isRunning = e.status === 'RUNNING' || e.status === 'OPEN';
        const lot = parseLot(e.catatan);
        return (
          <div key={e.rowNumber} className="card">
            <div className="card-row">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{e.stock}</span>
              <span className={badge.cls}>
                {pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : badge.label}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>
              Entry {e.entry?.toLocaleString('id-ID')} &middot; {lot ? `${lot} lot` : '- lot'}
              {e.tanggalExit ? ` → exit ${e.tanggalExit}` : ''}
            </p>
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
