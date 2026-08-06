import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import {
  getJournalEntries, closeJournalEntry, getSettings, updateSettings, ensureSheetsInitialized, getOrCreateAppDataSheetId,
} from '../lib/sheets';
import SettingsSheet from '../components/SettingsSheet';

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

function parseDDMMYYYY(s) {
  const match = String(s || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function daysHeld(entryDate, exitDate) {
  const from = parseDDMMYYYY(entryDate);
  const to = parseDDMMYYYY(exitDate);
  if (!from || !to) return null;
  return Math.round((to.setHours(0, 0, 0, 0) - from.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
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
  const [expandedRow, setExpandedRow] = useState(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [sheetId, setSheetId] = useState(null);

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
        const resolvedSheetId = await getOrCreateAppDataSheetId(token);
        if (cancelled) return;
        setSheetId(resolvedSheetId);
        await ensureSheetsInitialized(token, resolvedSheetId);
        const [data, settingsData] = await Promise.all([
          getJournalEntries(token, resolvedSheetId),
          getSettings(token, resolvedSheetId),
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
      await closeJournalEntry(token, sheetId, entry.rowNumber, {
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

  async function saveSettings({ capital, maxSlots }) {
    setSettingsSaving(true);
    try {
      await updateSettings(token, sheetId, { capital, maxSlots });
      setSettingsOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSettingsSaving(false);
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
  const runningEntries = settings ? entries.filter((e) => e.status === 'RUNNING' || e.status === 'OPEN') : [];
  const closedEntries = closed;
  const closedNet = closed.map((e) => computeNetPnl(e.entry, e.hargaExit, parseLot(e.catatan), settings));
  const wins = closedNet.filter((n) => n && n.pnlPercent >= 0).length;
  const losses = closedNet.filter((n) => n && n.pnlPercent < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const totalPnlRp = closedNet.reduce((sum, n) => sum + (n?.pnlRp || 0), 0);
  const totalPnlPercent = closedNet.reduce((sum, n) => sum + (n?.pnlPercent || 0), 0);
  const anyEstimated = closedNet.some((n) => n?.estimated);

  return (
    <div>
      <div className="page-header card-row">
        <div>
          <h1 className="page-title">Rekapan</h1>
          <p className="page-sub">Jurnal day trade &middot; P&amp;L sudah dikurangi fee &amp; materai</p>
        </div>
        <button className="btn icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Pengaturan">
          &#9881;
        </button>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        capital={settings ? settings.capital : 0}
        maxSlots={settings ? settings.maxSlots : 0}
        onSave={saveSettings}
        saving={settingsSaving}
      />

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

      {settings && runningEntries.map((e) => {
        const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
        const lot = parseLot(e.catatan);
        return (
          <div key={e.rowNumber} className="card">
            <div className="card-row">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{e.stock}</span>
              <span className={badge.cls}>{badge.label}</span>
            </div>
            <p className="muted" style={{ marginTop: 2 }}>
              Entry {e.entry?.toLocaleString('id-ID')} &middot; {lot ? `${lot} lot` : '- lot'} &middot; {e.tanggalEntry}
            </p>
            <p className="muted" style={{ marginTop: 2 }}>
              SL <span style={{ color: '#ff6b6b' }}>{e.sl?.toLocaleString('id-ID') || '-'}</span>
              {' · '}TP1 <span style={{ color: '#4fd07e' }}>{e.tp1?.toLocaleString('id-ID') || '-'}</span>
              {e.tp2 ? <> {' · '}TP2 <span style={{ color: '#4fd07e' }}>{e.tp2.toLocaleString('id-ID')}</span></> : null}
            </p>

            {closingRow !== e.rowNumber && (
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

      {settings && closedEntries.length > 0 && (
        <>
          <p style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>Sudah terjual</p>
          {closedEntries.map((e) => {
            const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
            const lot = parseLot(e.catatan);
            const net = computeNetPnl(e.entry, e.hargaExit, lot, settings);
            const held = daysHeld(e.tanggalEntry, e.tanggalExit);
            const expanded = expandedRow === e.rowNumber;
            return (
              <div
                key={e.rowNumber}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedRow(expanded ? null : e.rowNumber)}
              >
                <div className="card-row">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{e.stock}</span>
                  <span className={badge.cls}>
                    {net ? `${net.pnlPercent >= 0 ? '+' : ''}${net.pnlPercent.toFixed(2)}%` : badge.label}
                  </span>
                </div>
                <p className="muted" style={{ marginTop: 2 }}>
                  {e.tanggalEntry} &rarr; {e.tanggalExit}
                  {held !== null ? ` · ${held} hari` : ''}
                </p>

                {expanded && (
                  <>
                    <p className="muted" style={{ marginTop: 6 }}>
                      Entry {e.entry?.toLocaleString('id-ID')} &middot; Exit {e.hargaExit?.toLocaleString('id-ID')}
                      &middot; {lot ? `${lot} lot` : '- lot'}
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
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
