import { useEffect, useRef, useState } from 'react';
import { getAccessToken, resolveInitialToken } from '../lib/auth';
import {
  getJournalEntries, closeJournalEntry, confirmJournalFill, deleteJournalRow, getSettings, updateSettings,
  ensureSheetsInitialized, getOrCreateAppDataSheetId, updateJournalEntryTiers, savePartialSells,
} from '../lib/sheets';
import { computeTpMid } from '../lib/scoring';
import { daysHeld, computeNetPnl, computeEntryTotalPnl, sumPartialSellLot } from '../lib/pnl';
import SettingsSheet from '../components/SettingsSheet';
import PositionCard from '../components/PositionCard';
import { parseHargaInput, parseLotInput, computeWeightedEntryFromTiers, computeStatusFromTiers } from '../lib/journalInput';
import {
  formatRupiah, formatRupiahRingkas, todayDDMMYYYY, parseLotFromCatatan, parseDDMMYYYY,
} from '../lib/format';

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
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [closingRow, setClosingRow] = useState(null);
  const [exitPrice, setExitPrice] = useState('');
  const [partialSellingRow, setPartialSellingRow] = useState(null);
  const [partialSellPrice, setPartialSellPrice] = useState('');
  const [partialSellLot, setPartialSellLot] = useState('');
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
  const [tierCancelling, setTierCancelling] = useState(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [sheetId, setSheetId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    resolveInitialToken().then((t) => {
      if (cancelled) return;
      setToken(t);
      setCheckingAuth(false);
    });
    return () => { cancelled = true; };
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
      // Only the lot NOT already sold off via "Jual sebagian" is being
      // closed here - partial sells already banked their own P&L (see
      // sumRealizedPnl in lib/pnl.js), so closing against the full
      // original lot would double-count them.
      const remainingLot = parseLotFromCatatan(entry.catatan) - sumPartialSellLot(entry.partialSells);
      const net = computeNetPnl(entry.entry, exit, remainingLot, settings);
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

  function openPartialSellForm(entry) {
    setPartialSellingRow(entry.rowNumber);
    setPartialSellPrice(entry.tp1 ? String(entry.tp1) : '');
    setPartialSellLot('');
  }

  async function submitPartialSell(entry) {
    if (savingRef.current) return;
    const parsedPrice = parseHargaInput(partialSellPrice);
    const parsedLot = parseLotInput(partialSellLot);
    if (parsedPrice.error || parsedPrice.value === null) {
      setError(parsedPrice.error || 'Harga jual wajib diisi');
      return;
    }
    if (parsedLot.error || parsedLot.value === null) {
      setError(parsedLot.error || 'Jumlah lot wajib diisi');
      return;
    }
    const totalLot = parseLotFromCatatan(entry.catatan);
    const remainingLot = totalLot - sumPartialSellLot(entry.partialSells);
    if (parsedLot.value > remainingLot) {
      setError(`Lot yang dijual tidak boleh lebih dari sisa ${remainingLot} lot`);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const tanggal = `'${todayDDMMYYYY()}`;
      const nextSells = [...(entry.partialSells || []), { tanggal, hargaExit: parsedPrice.value, lot: parsedLot.value }];
      const stillRemaining = remainingLot - parsedLot.value;
      let closeEntry;
      if (stillRemaining === 0) {
        // Sold off the very last of it - close the row outright instead of
        // leaving a RUNNING position with nothing left to sell.
        const net = computeNetPnl(entry.entry, parsedPrice.value, parsedLot.value, settings);
        closeEntry = { tanggalExit: tanggal, hargaExit: parsedPrice.value, status: net.pnlPercent >= 0 ? 'CLOSE-PROFIT' : 'CLOSE-LOSS' };
      }
      await savePartialSells(token, sheetId, entry.rowNumber, { partialSells: nextSells, closeEntry });
      setPartialSellingRow(null);
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

  // Cancels ONE tier of an entry-3-tahap position (e.g. the "bawah" order
  // never got filled) without touching the others still pending/filled.
  // Entry/Catatan/Status are recomputed from the remaining tiers every
  // time - see lib/journalInput.js - so the position's numbers always
  // reflect only what was actually bought.
  async function cancelTier(entry, label) {
    if (!entry.entryTiers) return;
    setTierCancelling({ rowNumber: entry.rowNumber, label });
    try {
      const nextTiers = entry.entryTiers.map((t) => (
        t.label === label ? { ...t, status: 'CANCELLED', fillPrice: null, fillLot: null } : t
      ));
      const { entry: weightedEntry, lot: filledLot } = computeWeightedEntryFromTiers(nextTiers);
      await updateJournalEntryTiers(token, sheetId, entry.rowNumber, {
        entryTiers: nextTiers,
        entry: weightedEntry ?? entry.entry,
        lot: filledLot,
        status: computeStatusFromTiers(nextTiers),
      });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setTierCancelling(null);
    }
  }

  // Same five fields the Sinyal tab saves - this sheet is the same
  // Pengaturan panel on both tabs, so it must not quietly drop the settings
  // only Sinyal used to write (risiko per trade, basis entry, tampilan TP).
  async function saveSettings({
    capital, riskPercent, maxSlots,
    buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold,
    entryMode, tpMode, entryTierAtasPercent, entryTierTengahPercent,
  }) {
    setSettingsSaving(true);
    try {
      await updateSettings(token, sheetId, {
        capital, riskPercent, maxSlots,
        buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold,
        entryMode, tpMode, entryTierAtasPercent, entryTierTengahPercent,
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
    if (checkingAuth) {
      return (
        <div className="center-box">
          <div className="login-icon">📈</div>
          <p className="muted">Memeriksa sesi Google...</p>
        </div>
      );
    }
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
  // "Sudah terjual" also lists a still-RUNNING position that's only been
  // partially sold - some of its lot really has been sold already, even
  // though the position as a whole isn't closed yet, so hiding it here
  // until the rest closes made that sale look like it never happened.
  const partiallySoldRunning = settings
    ? entries.filter((e) => !e.status.startsWith('CLOSE') && e.partialSells && e.partialSells.length > 0)
    : [];
  // Newest sale first - a plain close uses its exit date, a still-open
  // position with partial sells uses the most recent one of those (pushed
  // onto the end of the list, see submitPartialSell below), so this sorts
  // by "when did something here last get sold" rather than entry order.
  function lastSaleDate(e) {
    const exitDate = e.status.startsWith('CLOSE') ? e.tanggalExit : null;
    const lastPartial = e.partialSells?.length ? e.partialSells[e.partialSells.length - 1].tanggal : null;
    const dates = [exitDate, lastPartial].filter(Boolean).map((d) => parseDDMMYYYY(String(d).replace(/^'/, '')));
    const valid = dates.filter(Boolean).map((d) => d.getTime());
    return valid.length ? Math.max(...valid) : 0;
  }
  const closedEntries = [...closed, ...partiallySoldRunning].sort((a, b) => lastSaleDate(b) - lastSaleDate(a));
  const closedNet = closed.map((e) => computeEntryTotalPnl(e, settings));
  const wins = closedNet.filter((n) => n && n.pnlPercent >= 0).length;
  const losses = closedNet.filter((n) => n && n.pnlPercent < 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : null;
  // "Total P&L bersih" at the top counts every rupiah already realized, not
  // just fully-closed trades - a partial sell on a still-RUNNING position
  // banks real P&L immediately (see lib/pnl.js's sumRealizedPnl) and should
  // move this number too, well before the rest of that position is closed.
  const realizedNet = settings
    ? entries.map((e) => computeEntryTotalPnl(e, settings)).filter(Boolean)
    : [];
  const totalPnlRp = realizedNet.reduce((sum, n) => sum + (n?.pnlRp || 0), 0);
  const totalPnlPercent = realizedNet.reduce((sum, n) => sum + (n?.pnlPercent || 0), 0);
  const anyEstimated = realizedNet.some((n) => n?.estimated);

  // Win rate split by trade type - only meaningful for entries recorded
  // after TradeType started being saved to the journal (see the
  // SHEET_HEADERS comment in lib/sheets.js); older entries with no
  // recorded type are excluded from this breakdown rather than guessed at.
  function winStatsFor(tradeType) {
    const list = closed.filter((e) => e.tradeType === tradeType);
    if (list.length === 0) return null;
    const net = list.map((e) => computeEntryTotalPnl(e, settings));
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
        <button
          className="btn icon-btn"
          onClick={() => setSettingsOpen(true)}
          disabled={!settings}
          aria-label="Pengaturan"
        >
          &#9881;
        </button>
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        capital={settings ? settings.capital : 0}
        riskPercent={settings ? settings.riskPercent : 0.005}
        maxSlots={settings ? settings.maxSlots : 0}
        buyFeePercent={settings ? settings.buyFeePercent : 0.0015}
        sellFeePercent={settings ? settings.sellFeePercent : 0.0025}
        materaiAmount={settings ? settings.materaiAmount : 10000}
        materaiThreshold={settings ? settings.materaiThreshold : 10000000}
        entryMode={settings ? settings.entryMode : 'mid'}
        tpMode={settings ? settings.tpMode : 'mid'}
        entryTierAtasPercent={settings ? settings.entryTierAtasPercent : 30}
        entryTierTengahPercent={settings ? settings.entryTierTengahPercent : 30}
        onSave={saveSettings}
        saving={settingsSaving}
      />

      <div className="hero-row">
        <div>
          <div className="hero-label">Total P&amp;L bersih</div>
          <div className={`hero-value ${totalPnlRp >= 0 ? 'text-success' : 'text-danger'}`}>
            {realizedNet.length > 0 ? `${totalPnlRp >= 0 ? '+' : ''}${formatRupiah(totalPnlRp)}` : '-'}
          </div>
          {realizedNet.length > 0 && (
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
        // The lot shown/acted on here is what's LEFT to sell - the original
        // bought lot (Catatan) minus whatever's already gone via "Jual
        // sebagian" (see lib/pnl.js's sumPartialSellLot).
        const lot = parseLotFromCatatan(e.catatan) - sumPartialSellLot(e.partialSells);
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
              partialSelling: partialSellingRow === e.rowNumber,
              menuOpen: menuRow === e.rowNumber,
              tvOpen: tvOpen.has(e.rowNumber),
              cancelling,
              tierCancelling: tierCancelling?.rowNumber === e.rowNumber ? tierCancelling.label : null,
              saving,
              confirmPrice,
              confirmLot,
              exitPrice,
              partialSellPrice,
              partialSellLot,
            }}
            actions={{
              onToggleExpand: () => { setExpandedRow(expanded ? null : e.rowNumber); setMenuRow(null); },
              onToggleMenu: () => setMenuRow(menuRow === e.rowNumber ? null : e.rowNumber),
              onToggleTv: () => toggleTv(e.rowNumber),
              onStartConfirm: () => openConfirmForm(e),
              onStartClose: () => openCloseForm(e),
              onStartPartialSell: () => openPartialSellForm(e),
              onCancelForm: () => { setConfirmingRow(null); setClosingRow(null); setPartialSellingRow(null); },
              onConfirmPriceChange: setConfirmPrice,
              onConfirmLotChange: setConfirmLot,
              onExitPriceChange: setExitPrice,
              onPartialSellPriceChange: setPartialSellPrice,
              onPartialSellLotChange: setPartialSellLot,
              onSubmitConfirm: () => submitConfirmFill(e),
              onSubmitClose: () => submitClose(e),
              onSubmitPartialSell: () => submitPartialSell(e),
              onCancelOrder: () => { setMenuRow(null); cancelOrder(e); },
              onCancelTier: (label) => cancelTier(e, label),
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
            const isClosed = e.status.startsWith('CLOSE');
            const badge = STATUS_BADGE[e.status] || { cls: 'badge', label: e.status.toLowerCase() };
            const lot = parseLotFromCatatan(e.catatan);
            const remainingLot = lot - sumPartialSellLot(e.partialSells);
            const net = computeEntryTotalPnl(e, settings);
            const held = isClosed ? daysHeld(e.tanggalEntry, e.tanggalExit) : null;
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
                    {!isClosed && <span className="badge badge-sm">sebagian</span>}
                  </span>
                  <span className="signal-head-right">
                    <span className={badge.cls}>
                      {net ? `${net.pnlPercent >= 0 ? '+' : ''}${net.pnlPercent.toFixed(2)}%` : badge.label}
                    </span>
                    <span className={`chev ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
                  </span>
                </button>
                <p className="muted" style={{ marginTop: 2 }}>
                  {isClosed ? (
                    <>{e.tanggalEntry} &rarr; {e.tanggalExit}{held !== null ? ` · ${held} hari` : ''}</>
                  ) : (
                    <>{e.tanggalEntry} &middot; posisi masih berjalan, sisa {remainingLot} lot</>
                  )}
                </p>

                {expanded && (
                  <>
                    <p className="muted" style={{ marginTop: 6 }}>
                      Entry {e.entry?.toLocaleString('id-ID')}
                      {isClosed ? (
                        <> &middot; Exit {e.hargaExit?.toLocaleString('id-ID')} &middot; {lot ? `${lot} lot` : '- lot'}</>
                      ) : (
                        <> &middot; sisa {remainingLot} lot masih terbuka</>
                      )}
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
                    {e.partialSells && e.partialSells.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <p className="muted" style={{ marginBottom: 4 }}>Sudah dijual sebagian</p>
                        {e.partialSells.map((p, i) => (
                          <div key={i} className="pb-row" style={{ marginTop: 2 }}>
                            <span className="muted">{p.tanggal?.replace(/^'/, '')} · {p.lot} lot</span>
                            <span>{p.hargaExit.toLocaleString('id-ID')}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
