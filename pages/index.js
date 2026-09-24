import { useEffect, useRef, useState } from 'react';
import { getAccessToken, resolveInitialToken, signOut } from '../lib/auth';
import {
  getValues, appendValues, ensureSheetsInitialized, getOrCreateAppDataSheetId, getSettings, updateSettings,
  getActiveJournalSummary, getJournalEntries, getModalHistory, addModalTransaction,
  getWaSignalRows, addWaSignalRows, removeWaSignalRow,
  pruneStaleWaSignalRows, WATCHLIST_SHEET_ID, WATCHLIST_RANGE,
} from '../lib/sheets';
import {
  parseWatchlistRows, parseWatchlistRowsRaw, parseSheetDate, rankSignals, buildWaSignal, mergeSignalSources,
  parseWaMessageText,
} from '../lib/scoring';
import { sumRealizedPnl } from '../lib/pnl';
import SignalCard from '../components/SignalCard';
import SettingsSheet from '../components/SettingsSheet';
import { formatRupiah, todayDDMMYYYY } from '../lib/format';
import { safeGetItem, safeRemoveItem } from '../lib/storage';
import { getDismissedSignals, dismissSignal, undismissSignal, pruneStaleDismissals } from '../lib/dismissedSignals';
import { getSkippedSignals, skipSignal, unskipSignal, pruneStaleSkips } from '../lib/skippedSignals';

// Temporary: the Google Sheet watchlist is paused as a signal source, so WA
// screenshots are the only way signals get in right now. Flip back to true
// to resume reading WATCHLIST_SHEET_ID again.
const WATCHLIST_SHEET_ENABLED = false;

// Key used by the old localStorage-based WA signal buffer (removed once
// signals moved to the WA_Signals sheet tab). Any device that still has
// signals sitting under this key gets them migrated up on next load instead
// of just losing them - the sheet starts out empty for everyone, so without
// this a device's WA signals would silently vanish the first time it loads
// the new code.
const LEGACY_WA_STORAGE_KEY = 'wa_signals_buffer_v2';

function readLegacyWaSignals() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(safeGetItem(LEGACY_WA_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

// Segment widths for the price range bar now live in components/SignalCard.js,
// next to the markup that uses them.

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildAiPrompt(signals) {
  const lines = signals.map((s) => {
    const range = s.buyLow != null && s.buyHigh != null && s.buyLow !== s.buyHigh
      ? `range beli ${s.buyLow}-${s.buyHigh}, `
      : '';
    return `${s.stock}: ${range}entry estimasi ${s.entry}, SL ${s.sl} (${s.slPercent.toFixed(2)}%), TP1 ${s.tp1} (${s.tp1Percent.toFixed(2)}%)`;
  });
  return `Tolong analisa saham-saham berikut, kasih tau trennya kemana, peluang naiknya, dan menurut kamu sebaiknya entry di harga berapa dari range yang tersedia:\n\n${lines.join('\n')}`;
}

export default function SinyalPage() {
  const [token, setToken] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signals, setSignals] = useState([]);
  const [settings, setSettings] = useState(null);
  const [totalModal, setTotalModal] = useState(0);
  const [modalHistory, setModalHistory] = useState([]);
  const [investedCapital, setInvestedCapital] = useState(0);
  const [usedSlots, setUsedSlots] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  // Only the chart toggle is left here: the per-card form state (which card is
  // recording, what was typed into it) now lives inside SignalCard, where a
  // single card's own business belongs.
  const [tvOpen, setTvOpen] = useState(new Set());
  const savingRef = useRef(false);

  const [waExtracting, setWaExtracting] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waExtractError, setWaExtractError] = useState(null);
  const [waReview, setWaReview] = useState(null);
  const waPasteZoneRef = useRef(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Each Google account gets its own auto-created spreadsheet for
  // Settings/DayTrade_Journal - resolved once per sign-in, then reused for
  // every sheet call below instead of a shared hardcoded ID.
  const [sheetId, setSheetId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Tries the cached token first, then a silent (popup-free) sign-in if
    // there isn't one - most returning visitors land straight in the app
    // instead of hitting "Sign in dengan Google" again every time the
    // cached token from last time has expired.
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
        const [rawRows, settingsData, journalSummary, journalEntries, modalHistoryData, waRaw] = await Promise.all([
          // Dibaca terus (lepas dari WATCHLIST_SHEET_ENABLED) karena sekarang
          // juga dipakai buat mencocokkan tanggal sinyal WA dengan tanggal
          // Watchlist-nya, bukan cuma sebagai sumber sinyal aktif.
          getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token).catch(() => []),
          getSettings(token, resolvedSheetId),
          // Satu request buat count/journaledStocks/investedCapital sekaligus,
          // bukan 3 request terpisah ke range jurnal yang sama persis.
          getActiveJournalSummary(token, resolvedSheetId),
          // Seluruh jurnal (bukan cuma yang aktif) - dipakai buat menjumlah
          // P&L realized sepanjang waktu untuk Total Modal di bawah.
          getJournalEntries(token, resolvedSheetId),
          getModalHistory(token, resolvedSheetId),
          getWaSignalRows(token, resolvedSheetId),
        ]);
        if (cancelled) return;
        const { activeCount: occupiedSlots, journaledStocks: journaled, investedCapital: invested } = journalSummary;
        setSettings(settingsData);
        setInvestedCapital(invested);
        setUsedSlots(occupiedSlots);
        setModalHistory(modalHistoryData);
        // Total Modal = Modal Awal (settingsData.capital, sudah termasuk semua
        // setor/tarik lewat "Tambah/Kurang Modal") +/- akumulasi untung/rugi
        // realized dari SELURUH riwayat jurnal - bukan cuma yang lagi tampil
        // di Rekapan. Dipakai sebagai basis MM/risk-per-trade di bawah, jadi
        // ukuran posisi otomatis mengikuti modal yang sedang berjalan.
        const computedTotalModal = settingsData.capital + sumRealizedPnl(journalEntries, settingsData);
        setTotalModal(computedTotalModal);
        const parsed = WATCHLIST_SHEET_ENABLED
          ? parseWatchlistRows(rawRows, { entryMode: settingsData.entryMode, tpMode: settingsData.tpMode })
          : [];

        const watchlistDateByStock = new Map();
        try {
          for (const r of parseWatchlistRowsRaw(rawRows)) {
            const d = parseSheetDate(r.date);
            if (d) watchlistDateByStock.set(r.stock.toUpperCase(), d);
          }
        } catch {
          // Sheet sumber kosong/berubah struktur - abaikan, sinyal WA yang
          // tidak cocok tetap dianggap "Terbit hari ini".
        }

        let effectiveWaRaw = waRaw;
        if (waRaw.length === 0) {
          const legacy = readLegacyWaSignals();
          if (legacy.length > 0) {
            await addWaSignalRows(token, resolvedSheetId, legacy);
            safeRemoveItem(LEGACY_WA_STORAGE_KEY);
            effectiveWaRaw = legacy;
          }
        }
        const waBuilt = effectiveWaRaw.map((s) => buildWaSignal({
          ...s,
          entryMode: settingsData.entryMode,
          tpMode: settingsData.tpMode,
          watchlistDate: watchlistDateByStock.get(s.stock.trim().toUpperCase()) || null,
        }));
        const { combined, staleWaStocks } = mergeSignalSources(parsed, waBuilt);
        if (staleWaStocks.length > 0) await pruneStaleWaSignalRows(token, resolvedSheetId, staleWaStocks);

        pruneStaleSkips();
        const skippedSet = new Set(getSkippedSignals());
        // A manually-skipped stock is pulled out BEFORE ranking (not just
        // filtered from the result) so it doesn't occupy a slot the system
        // would otherwise give to it - the next-best candidate gets
        // promoted into that freed slot instead. It's re-added afterwards
        // as its own always-skipped entry so it stays visible (grayed out
        // via the existing .skip-card look), just out of slot contention.
        const rankable = combined.filter((s) => !skippedSet.has(s.stock.toUpperCase()));
        const manuallySkipped = combined
          .filter((s) => skippedSet.has(s.stock.toUpperCase()))
          .map((s) => ({
            ...s, rank: null, willSkip: true, skipReason: 'dilewati-manual',
            position: { rupiah: 0, lembar: 0 }, owned: journaled.has(s.stock.toUpperCase()),
          }));

        const remainingCapital = Math.max(computedTotalModal - invested, 0);
        const ranked = rankSignals(rankable, {
          capital: computedTotalModal, riskPercent: settingsData.riskPercent, remainingCapital,
          maxSlots: settingsData.maxSlots, occupiedSlots, journaledStocks: journaled,
        });

        pruneStaleDismissals();
        const dismissedSet = new Set(getDismissedSignals());
        // Already-bought (journaled) and dismissed signals don't belong in
        // this list anymore - the journal/Rekapan tab is where owned
        // positions live, and a dismissed signal was explicitly hidden.
        setSignals(
          [...ranked, ...manuallySkipped].filter((s) => !s.owned && !dismissedSet.has(s.stock.toUpperCase()))
        );
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  // Called by SignalCard once its own form is filled and validated. Errors are
  // deliberately NOT caught here: throwing lets the card show the message next
  // to the fields, instead of the page-level banner that is meant for
  // load/sign-in failures.
  async function submitRecord(s, { price, lot, filled }) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const row = [
        // Leading "'" forces Sheets to keep this as literal text instead of
        // silently converting "03-08-2026" into a date serial number (46237).
        `'${todayDDMMYYYY()}`, s.stock, price, s.sl, s.tp1, s.tp2 || '',
        filled ? 'RUNNING' : 'PENDING', '', '', `Lot: ${lot ?? '-'}`, s.tradeType || '', s.tag || '',
      ];
      await appendValues(sheetId, 'DayTrade_Journal!A:L', [row], token);
      setRefreshKey((k) => k + 1);
    } finally {
      savingRef.current = false;
    }
  }

  async function extractWaSignals(body) {
    setWaExtracting(true);
    setWaExtractError(null);
    try {
      const res = await fetch('/api/extract-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, type: 'wa_signal' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membaca pesan WA');
      const validSignals = (data.signals || []).filter(
        (s) => s.tradeType === 'DAY TRADE' || s.tradeType === 'SWING TRADE'
      );
      setWaReview(validSignals);
    } catch (err) {
      setWaExtractError(err.message);
    } finally {
      setWaExtracting(false);
    }
  }

  async function processWaImage(file) {
    const base64 = await fileToBase64(file);
    await extractWaSignals({ image: base64, mimeType: file.type });
  }

  async function processWaText(text) {
    // Try the plain-JS parser first - if the pasted message matches the
    // standard WA-announcement layout, this reads it instantly with no
    // network round trip at all. Only fall back to the AI endpoint (a few
    // seconds, and counts against the daily Gemini quota) when the text
    // doesn't match that shape - free-form phrasing, reordered lines, etc.
    const localSignals = parseWaMessageText(text);
    if (localSignals.length > 0) {
      setWaReview(localSignals.filter((s) => s.tradeType === 'DAY TRADE' || s.tradeType === 'SWING TRADE'));
      return;
    }
    await extractWaSignals({ text });
  }

  // Paste zone accepts either a screenshot (image data) or the WA message
  // copied as plain text - same extraction endpoint either way, Gemini
  // handles both. Image takes priority if somehow both are on the clipboard.
  function handleWaPasteZone(e) {
    e.preventDefault();
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (waPasteZoneRef.current) waPasteZoneRef.current.innerHTML = '';
    if (item) {
      const file = item.getAsFile();
      if (file) processWaImage(file);
    } else if (text) {
      processWaText(text);
    }
  }

  // Ctrl+V anywhere on the Sinyal tab pastes a screenshot straight in, no
  // need to save the file first or click into the paste zone. Text paste is
  // only handled globally when nothing else is focused (so pasting into the
  // entry-price/lot/settings inputs elsewhere on the page still behaves
  // normally) - typing WA text needs the dedicated paste zone above instead.
  useEffect(() => {
    if (!token || waReview !== null) return;
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) {
        const file = item.getAsFile();
        if (file) processWaImage(file);
        return;
      }
      const activeTag = document.activeElement?.tagName;
      const activeEditable = document.activeElement?.isContentEditable;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeEditable) return;
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (text) processWaText(text);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [token, waReview]);

  function updateWaReviewField(index, field, value) {
    setWaReview((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function removeWaReviewRow(index) {
    setWaReview((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirmWaSignals() {
    setWaSaving(true);
    setWaExtractError(null);
    try {
      const signals = waReview.map((s) => ({
        stock: s.stock,
        tradeType: s.tradeType === 'SWING TRADE' ? 'SWING TRADE' : 'DAY TRADE',
        buyLow: Number(s.buyLow),
        buyHigh: Number(s.buyHigh),
        sl: Number(s.sl),
        tp1: Number(s.tp1),
        tp2: s.tp2 ? Number(s.tp2) : null,
        mmPercent: s.mmPercent != null ? Number(s.mmPercent) : null,
        capturedAt: new Date().toISOString(),
        tag: s.tag || null,
      }));
      await addWaSignalRows(token, sheetId, signals);
      // A stock dismissed in an earlier, unrelated signal round shouldn't
      // keep hiding this brand new one just because it shares the same
      // symbol - the user is explicitly re-adding it right now.
      signals.forEach((s) => undismissSignal(s.stock));
      setWaReview(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setWaExtractError(e.message);
    } finally {
      setWaSaving(false);
    }
  }

  async function saveSettings({
    capital, riskPercent, maxSlots,
    buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold,
    entryMode, tpMode,
  }) {
    setSettingsSaving(true);
    try {
      await updateSettings(token, sheetId, {
        capital, riskPercent, maxSlots,
        buyFeePercent, sellFeePercent, materaiAmount, materaiThreshold,
        entryMode, tpMode,
      });
      setSettingsOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function submitModalTransaction({ jumlah, keterangan }) {
    setSettingsSaving(true);
    try {
      await addModalTransaction(token, sheetId, {
        tanggal: todayDDMMYYYY(), jumlah, keterangan, currentCapital: settings.capital,
      });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  function copyOne(signal) {
    navigator.clipboard.writeText(buildAiPrompt([signal]));
  }

  function toggleTv(cardKey) {
    setTvOpen((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey); else next.add(cardKey);
      return next;
    });
  }

  // Different from "hapus": skipping keeps the signal visible (grayed out)
  // and just pulls it out of slot competition for this round, so the
  // next-best candidate gets the freed slot - "hapus" removes it from view
  // entirely instead.
  function toggleSkipSignal(s) {
    if (s.skipReason === 'dilewati-manual') {
      unskipSignal(s.stock);
    } else {
      skipSignal(s.stock);
    }
    setRefreshKey((k) => k + 1);
  }

  async function hapusSignal(s) {
    try {
      if (s.source === 'wa') {
        await removeWaSignalRow(token, sheetId, s.stock);
      } else {
        dismissSignal(s.stock);
      }
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  // Editing the entry price shifts buyLow/buyHigh by the same delta instead
  // of collapsing them down to a single number or storing a separate
  // override field - the midpoint-of-range rule that computes `entry`
  // elsewhere stays the single source of truth (so position sizing, the
  // range bar, etc. don't need special-casing), AND the original buy range
  // width is preserved so "605-630" style context keeps showing under the
  // entry, just recentered on the price the user actually typed.
  async function submitEntry(s, newEntry) {
    const delta = newEntry - s.entry;
    await addWaSignalRows(token, sheetId, [{
      stock: s.stock,
      tradeType: s.tradeType,
      buyLow: s.buyLow + delta,
      buyHigh: s.buyHigh + delta,
      sl: s.sl,
      tp1: s.tp1,
      tp2: s.tp2,
      mmPercent: s.mmPercent,
      capturedAt: s.capturedAt,
      tag: s.tag,
    }]);
    setRefreshKey((k) => k + 1);
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
        <h1 className="login-title">Sinyal Saham Harian</h1>
        <p className="login-sub">Masuk dengan akun Google untuk melihat sinyal hari ini.</p>
        <button className="btn btn-primary login-btn" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted text-danger" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  const remainingCapital = settings ? Math.max(totalModal - investedCapital, 0) : null;
  // No date split anymore - a signal stays listed for as long as it's still
  // OPEN/valid in the sheet, not just on the day it was first published.
  // Not-skipped candidates first, then best score first.
  const sortBest = (a, b) => (Number(a.willSkip) - Number(b.willSkip)) || (b.score - a.score);
  const sortedSignals = [...signals].sort(sortBest);
  const dayTradeSignals = sortedSignals.filter((s) => s.tradeType === 'DAY TRADE');
  const swingTradeSignals = sortedSignals.filter((s) => s.tradeType === 'SWING TRADE');

  if (waReview !== null) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Review sinyal WA</h1>
          <p className="page-sub">Periksa dulu angkanya sebelum ditambahkan</p>
        </div>

        {waReview.length === 0 && (
          <p className="muted">Tidak ada sinyal yang terbaca dari screenshot ini.</p>
        )}

        {waReview.map((s, i) => (
          <div key={i} className="card">
            <div className="card-row">
              <input
                value={s.stock}
                onChange={(e) => updateWaReviewField(i, 'stock', e.target.value)}
                style={{ width: '40%', fontWeight: 600 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.confidence === 'low' && <span className="badge badge-warning">cek lagi</span>}
                <button className="btn" style={{ padding: '4px 8px' }} onClick={() => removeWaReviewRow(i)}>hapus</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Buy low</p>
                <input type="number" value={s.buyLow} onChange={(e) => updateWaReviewField(i, 'buyLow', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>Buy high</p>
                <input type="number" value={s.buyHigh} onChange={(e) => updateWaReviewField(i, 'buyHigh', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>SL</p>
                <input type="number" value={s.sl} onChange={(e) => updateWaReviewField(i, 'sl', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>TP1</p>
                <input type="number" value={s.tp1} onChange={(e) => updateWaReviewField(i, 'tp1', e.target.value)} />
              </div>
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>TP2 (opsional)</p>
                <input type="number" value={s.tp2 || ''} onChange={(e) => updateWaReviewField(i, 'tp2', e.target.value)} />
              </div>
            </div>
          </div>
        ))}

        {waExtractError && <p className="muted text-danger">{waExtractError}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setWaReview(null)} disabled={waSaving}>Batal</button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={confirmWaSignals}
            disabled={waReview.length === 0 || waSaving}
          >
            {waSaving ? 'Menyimpan...' : 'Tambahkan ke daftar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <h1 className="page-title">Sinyal Saham Harian</h1>
          <button className="btn icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Pengaturan">
            &#9881;
          </button>
        </div>
        {settings ? (
          <>
            <div className="hero-row">
              <div>
                <div className="hero-label">Sisa modal</div>
                <div className="hero-value">{formatRupiah(remainingCapital)}</div>
              </div>
              <span className="slot-pill">Slot {usedSlots}/{settings.maxSlots}</span>
            </div>
            <div className="sub-boxes">
              <div className="sub-box">
                <div className="sub-box-label">Terpakai</div>
                <div className="sub-box-value">{formatRupiah(investedCapital)}</div>
              </div>
              <div className="sub-box">
                <div className="sub-box-label">Total modal</div>
                <div className="sub-box-value">{formatRupiah(totalModal)}</div>
              </div>
            </div>
          </>
        ) : (
          <p className="page-sub">...</p>
        )}
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
        onSave={saveSettings}
        saving={settingsSaving}
        modalHistory={modalHistory}
        onSubmitModalTransaction={submitModalTransaction}
      />

      <div className="wa-paste-zone-wrap">
        <div
          ref={waPasteZoneRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handleWaPasteZone}
          className="wa-paste-zone"
        />
        {/* Non-editable caption overlaid on the paste target - it's just a
            hint ("paste here"), not text the user should be able to type
            into or accidentally edit. */}
        <span className="wa-paste-zone-label">
          {waExtracting ? 'Membaca sinyal baru...' : 'Tempel sinyal baru'}
        </span>
      </div>
      {waExtractError && <p className="muted text-danger">{waExtractError}</p>}

      {loading && <p className="muted">Memuat sinyal...</p>}
      {error && <p className="muted text-danger">{error}</p>}

      {!loading && signals.length === 0 && !error && (
        <p className="muted">Belum ada sinyal baru hari ini.</p>
      )}

      <p style={{ marginTop: 8, marginBottom: 8, fontWeight: 600 }}>Day Trade</p>
      {dayTradeSignals.length === 0 && <p className="muted">Belum ada sinyal day trade hari ini.</p>}
      {dayTradeSignals.map((s, i) => (
        <SignalCard
          key={s.stock + s.status}
          signal={s}
          settings={settings}
          spotlight={i === 0 && !s.willSkip}
          tvOpen={tvOpen.has(s.stock + s.status)}
          onCopy={copyOne}
          onToggleTv={() => toggleTv(s.stock + s.status)}
          onToggleSkip={toggleSkipSignal}
          onRemove={hapusSignal}
          onSaveRecord={submitRecord}
          onSaveEntry={submitEntry}
        />
      ))}

      <p style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>Swing Trade</p>
      {swingTradeSignals.length === 0 && <p className="muted">Belum ada sinyal swing trade hari ini.</p>}
      {swingTradeSignals.map((s, i) => (
        <SignalCard
          key={s.stock + s.status}
          signal={s}
          settings={settings}
          spotlight={i === 0 && !s.willSkip}
          tvOpen={tvOpen.has(s.stock + s.status)}
          onCopy={copyOne}
          onToggleTv={() => toggleTv(s.stock + s.status)}
          onToggleSkip={toggleSkipSignal}
          onRemove={hapusSignal}
          onSaveRecord={submitRecord}
          onSaveEntry={submitEntry}
        />
      ))}

      <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={() => { signOut(); setToken(null); }}>
        Keluar
      </button>
    </div>
  );
}
