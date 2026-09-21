import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken } from '../lib/auth';
import {
  getJournalEntries, closeJournalEntry, confirmJournalFill, deleteJournalRow, getSettings, updateSettings,
  ensureSheetsInitialized, getOrCreateAppDataSheetId,
} from '../lib/sheets';
import { computeTpMid } from '../lib/scoring';
import { daysHeld, computeNetPnl } from '../lib/pnl';
import SettingsSheet from '../components/SettingsSheet';
import PositionCard from '../components/PositionCard';
import { parseHargaInput, parseLotInput } from '../lib/journalInput';
import { formatRupiah, formatRupiahRingkas, todayDDMMYYYY, parseLotFromCatatan } from '../lib/format';

const STATUS_BADGE = {
  RUNNING: { cls: 'badge', label: 'running' },
  PENDING: { cls: 'badge badge-warning', label: 'order pending' },
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
  const [menuRow, setMenuRow] = useState(null);
  const [tvOpen, setTvOpen] = useState(new Set());
  // "Sudah terjual" list is hidden by default - most visits only care
  // about open positions, so closed history stays out of the way until
  // explicitly asked for by clicking the section header.
  const [showClosed, setShowClosed] = useState(false);

  function toggleTv(rowNumber) {
    setTvOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
      return next;
    });
  }

  const [confirmingRow, setConfirmingRow] = useState(null);
  const [confirmPrice, setConfirmPrice] = useState('');
  const [confirmLot, setConfirmLot] = useState('');
  const [cancelling, setCancelling] = useState(false);

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
    const parsedExit = parseHargaInput(exitPrice);
    if (parsedExit.error || parsedExit.value === null) {
      setError(parsedExit.error || 'Harga exit wajib diisi');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const exit = parsedExit.value;
      const lot = parseLotFromCatatan(entry.catatan);
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

  function openConfirmForm(entry) {
    setConfirmingRow(entry.rowNumber);
    setConfirmPrice(String(entry.entry));
    setConfirmLot(String(parseLotFromCatatan(entry.catatan)));
  }

  async function submitConfirmFill(entry) {
    if (savingRef.current) return;
    const parsedPrice = parseHargaInput(confirmPrice);
    const parsedLot = parseLotInput(confirmLot);
    if (parsedPrice.error || parsedLot.error) {
      setError(parsedPrice.error || parsedLot.error);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await confirmJournalFill(token, sheetId, entry.rowNumber, {
        entry: parsedPrice.value ?? entry.entry,
        lot: parsedLot.value ?? parseLotFromCatatan(entry.catatan),
      });
      setConfirmingRow(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function cancelOrder(entry) {
    if (!window.confirm(`Batalkan order ${entry.stock}? Baris ini akan dihapus dari jurnal.`)) return;
    setCancelling(true);
    try {
      await deleteJournalRow(token, sheetId, entry.rowNumber);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setCancelling(false);
    }
  }

  // Same five fields the Sinyal tab saves - this sheet is the same
  // Pengaturan panel on both tabs, so it must not quietly drop the settings
  // only Sinyal used to write (risiko per trade, basis entry, tampilan TP).
  async function saveSettings({
    capital, riskPercent, maxSlots, entryMode, tpMode,
  }) {
    setSettingsSaving(true);
    try {
      await updateSettings(token, sheetId, {
        capital, riskPercent, maxSlots, entryMode, tpMode,
      });
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
        <div className="login-icon">📈</div>
        <h1 className="login-title">Rekapan</h1>
        <p className="login-sub">Masuk dengan akun Google untuk melihat rekapan.</p>
        <button className="btn btn-primary login-btn" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted text-danger" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const closed = settings ? entries.filter((e) => e.status.startsWith('CLOSE')) : [];
  const runningEntries = settings
    ? entries.filter((e) => e.status === 'RUNNING' || e.status === 'PENDING' || e.status === 'OPEN')
    : [];
  const closedEntries = closed;
  const closedNet = closed.map((e) => computeNetPnl(e.entry, e.hargaExit, parseLotFromCatatan(e.catatan), settings));
  const wins = closedNet.filter((n) => n && n.pnlPercent >= 0).length;
  const losses = closedNet.filter((n) => n && n.pnlPercent < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  const totalPnlRp = closedNet.reduce((sum, n) => sum + (n?.pnlRp || 0), 0);
  const totalPnlPercent = closedNet.reduce((sum, n) => sum + (n?.pnlPercent || 0), 0);
  const anyEstimated = closedNet.some((n) => n?.estimated);

  // Win rate split by trade type - only meaningful for entries recorded
  // after TradeType started being saved to the journal (see the
  // SHEET_HEADERS comment in lib/sheets.js); older entries with no
  // recorded type are excluded from this breakdown rather than guessed at.
  function winStatsFor(tradeType) {
    const list = closed.filter((e) => e.tradeType === tradeType);
    if (list.length === 0) return null;
    const net = list.map((e) => computeNetPnl(e.entry, e.hargaExit, parseLotFromCatatan(e.catatan), settings));
    const w = net.filter((n) => n && n.pnlPercent >= 0).length;
    return { winRate: (w / list.length) * 100, wins: w, losses: list.length - w, total: list.length };
  }
  const dayStats = winStatsFor('DAY TRADE');
  const swingStats = winStatsFor('SWING TRADE');
  const untrackedTypeCount = closed.filter((e) => e.tradeType !== 'DAY TRADE' && e.tradeType !== 'SWING TRADE').length;

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
        riskPercent={settings ? settings.riskPercent : 0.005}
        maxSlots={settings ? settings.maxSlots : 0}
        entryMode={settings ? settings.entryMode : 'mid'}
        tpMode={settings ? settings.tpMode : 'mid'}
        onSave={saveSettings}
        saving={settingsSaving}
      />

      <div className="hero-row">
        <div>
          <div className="hero-label">Total P&amp;L bersih</div>
          <div className={`hero-value ${totalPnlRp >= 0 ? 'text-success' : 'text-danger'}`}>
            {closedEntries.length > 0 ? `${totalPnlRp >= 0 ? '+' : ''}${formatRupiahRingkas(totalPnlRp)}` : '-'}
          </div>
          {closedEntries.length > 0 && (
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
              {anyEstimated ? ' · sebagian estimasi (lot tidak tercatat)' : ''}
            </p>
          )}
        </div>
        <span className="slot-pill">{runningEntries.length} posisi berjalan</span>
      </div>

      {/* Win rate / menang / kalah stay in small tiles: they matter over weeks,
          while the P&L above is what gets looked at every day. */}
      <div className="stat-grid cols-3">
        <div className="stat-tile">
          <div className="stat-label">Win rate</div>
          <div className="stat-value text-success">
            {winRate !== null ? `${winRate.toFixed(1)}%` : '-'}
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

      {(dayStats || swingStats) && (
        <div className="settings-section">
          <p className="settings-section-title">📊 Win rate per jenis</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div className="stat-label">Day Trade</div>
              <div className="stat-value text-success" style={{ fontSize: 16 }}>
                {dayStats ? `${dayStats.winRate.toFixed(1)}%` : '-'}
              </div>
              {dayStats && (
                <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {dayStats.wins} menang / {dayStats.losses} kalah dari {dayStats.total}
                </p>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div className="stat-label">Swing Trade</div>
              <div className="stat-value text-success" style={{ fontSize: 16 }}>
                {swingStats ? `${swingStats.winRate.toFixed(1)}%` : '-'}
              </div>
              {swingStats && (
                <p className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {swingStats.wins} menang / {swingStats.losses} kalah dari {swingStats.total}
                </p>
              )}
            </div>
          </div>
          {untrackedTypeCount > 0 && (
            <p className="field-hint" style={{ marginTop: 8 }}>
              {untrackedTypeCount} entri lama belum tercatat jenisnya (Day/Swing), jadi tidak masuk breakdown ini.
            </p>
          )}
        </div>
      )}

      {loading && <p className="muted">Memuat jurnal...</p>}
      {error && <p className="muted text-danger">{error}</p>}
      {!loading && entries.length === 0 && !error && (
        <p className="muted">Belum ada transaksi tercatat. Catat dari Tab Sinyal setelah beli.</p>
      )}

{settings && runningEntries.map((e) => {
        const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
        const lot = parseLotFromCatatan(e.catatan);
        const expanded = expandedRow === e.rowNumber;
        return (
          <PositionCard
            key={e.rowNumber}
            entry={e}
            settings={settings}
            badge={badge}
            lot={lot}
            ui={{
              expanded,
              confirming: confirmingRow === e.rowNumber,
              closing: closingRow === e.rowNumber,
              menuOpen: menuRow === e.rowNumber,
              tvOpen: tvOpen.has(e.rowNumber),
              cancelling,
              saving,
              confirmPrice,
              confirmLot,
              exitPrice,
            }}
            actions={{
              onToggleExpand: () => { setExpandedRow(expanded ? null : e.rowNumber); setMenuRow(null); },
              onToggleMenu: () => setMenuRow(menuRow === e.rowNumber ? null : e.rowNumber),
              onToggleTv: () => toggleTv(e.rowNumber),
              onStartConfirm: () => openConfirmForm(e),
              onStartClose: () => openCloseForm(e),
              onCancelForm: () => { setConfirmingRow(null); setClosingRow(null); },
              onConfirmPriceChange: setConfirmPrice,
              onConfirmLotChange: setConfirmLot,
              onExitPriceChange: setExitPrice,
              onSubmitConfirm: () => submitConfirmFill(e),
              onSubmitClose: () => submitClose(e),
              onCancelOrder: () => { setMenuRow(null); cancelOrder(e); },
            }}
          />
        );
      })}

      {settings && closedEntries.length > 0 && (
        <>
          <button
            type="button"
            className="card-row"
            style={{
              width: '100%', background: 'none', border: 'none', padding: 0, marginTop: 16, marginBottom: 8, cursor: 'pointer',
              font: 'inherit', color: 'inherit', textAlign: 'left',
            }}
            onClick={() => setShowClosed((v) => !v)}
          >
            <span style={{ fontWeight: 600 }}>Sudah terjual ({closedEntries.length})</span>
            <span className="muted">{showClosed ? 'Sembunyikan ▴' : 'Tampilkan ▾'}</span>
          </button>
          {showClosed && closedEntries.map((e) => {
            const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
            const lot = parseLotFromCatatan(e.catatan);
            const net = computeNetPnl(e.entry, e.hargaExit, lot, settings);
            const held = daysHeld(e.tanggalEntry, e.tanggalExit);
            const expanded = expandedRow === e.rowNumber;
            return (
              <div key={e.rowNumber} className="card signal-card">
                <button
                  type="button"
                  className="signal-head"
                  onClick={() => setExpandedRow(expanded ? null : e.rowNumber)}
                  aria-expanded={expanded}
                >
                  <span className="signal-head-left">
                    <span className="ticker">{e.stock}</span>
                    {e.tag && <span className="badge badge-sm">{e.tag}</span>}
                  </span>
                  <span className="signal-head-right">
                    <span className={badge.cls}>
                      {net ? `${net.pnlPercent >= 0 ? '+' : ''}${net.pnlPercent.toFixed(2)}%` : badge.label}
                    </span>
                    <span className={`chev ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
                  </span>
                </button>
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
                      <p className={`muted ${net.pnlRp >= 0 ? 'text-success' : 'text-danger'}`} style={{ marginTop: 2 }}>
                        {net.pnlRp >= 0 ? '+' : ''}{formatRupiah(net.pnlRp)} bersih (sudah dikurangi fee &amp; materai)
                      </p>
                    )}
                    <p className="muted" style={{ marginTop: 2 }}>
                      SL <span className="text-danger">{e.sl?.toLocaleString('id-ID') || '-'}</span>
                      {settings && settings.tpMode === 'separate' ? (
                        <>
                          {' · '}TP1 <span className="text-success">{e.tp1?.toLocaleString('id-ID') || '-'}</span>
                          {e.tp2 ? <> {' · '}TP2 <span className="text-success">{e.tp2.toLocaleString('id-ID')}</span></> : null}
                        </>
                      ) : (
                        e.tp1 != null && (
                          <> {' · '}TP <span className="text-success">{computeTpMid(e.tp1, e.tp2).toLocaleString('id-ID')}</span></>
                        )
                      )}
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
