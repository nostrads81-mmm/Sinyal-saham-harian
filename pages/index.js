import { useEffect, useRef, useState } from 'react';
import { getAccessToken, getStoredToken, signOut } from '../lib/auth';
import {
  getValues, appendValues, ensureSheetsInitialized, getOrCreateAppDataSheetId, getSettings, updateSettings,
  getActiveJournalSummary, getWaSignalRows, addWaSignalRows, removeWaSignalRow,
  pruneStaleWaSignalRows, WATCHLIST_SHEET_ID, WATCHLIST_RANGE,
} from '../lib/sheets';
import {
  parseWatchlistRows, parseWatchlistRowsRaw, parseSheetDate, rankSignals, buildWaSignal, mergeSignalSources,
} from '../lib/scoring';
import SettingsSheet from '../components/SettingsSheet';
import { getDismissedSignals, dismissSignal, undismissSignal, pruneStaleDismissals } from '../lib/dismissedSignals';
import TradingViewQuote from '../components/TradingViewQuote';
import TradingViewButton from '../components/TradingViewButton';

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
    return JSON.parse(localStorage.getItem(LEGACY_WA_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function formatRupiah(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

// Segment widths (as flex-grow numbers) for the SL-entry-TP1-TP2 price range
// bar, proportional to the actual price gaps so the bar visually reflects
// how far each level sits from the others, not just evenly-spaced ticks.
// A decorative "beyond TP" filler segment is appended so the bar doesn't
// end abruptly right at the last known target.
function buildRangeBar(sl, entry, tp1, tp2) {
  const slToEntry = Math.max(entry - sl, 0.01);
  const entryToTp1 = Math.max(tp1 - entry, 0.01);
  const tp1ToTp2 = Math.max((tp2 != null ? tp2 - tp1 : entryToTp1), 0.01);
  const beyond = tp1ToTp2 * 0.6;
  const total = slToEntry + entryToTp1 + tp1ToTp2 + beyond;
  return {
    slFlex: slToEntry,
    midFlex: entryToTp1,
    tpFlex: tp1ToTp2,
    beyondFlex: beyond,
    markerPercent: (slToEntry / total) * 100,
  };
}

function todayDDMMYYYY() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signals, setSignals] = useState([]);
  const [settings, setSettings] = useState(null);
  const [investedCapital, setInvestedCapital] = useState(0);
  const [journaledStocks, setJournaledStocks] = useState(new Set());
  const [usedSlots, setUsedSlots] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordingStock, setRecordingStock] = useState(null);
  const [fillPrice, setFillPrice] = useState('');
  const [fillLot, setFillLot] = useState('');
  const [orderFilled, setOrderFilled] = useState(true);
  const [tvOpen, setTvOpen] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const savingRef = useRef(false);

  const [editingEntryStock, setEditingEntryStock] = useState(null);
  const [entryInput, setEntryInput] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState(null);

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
        const [rawRows, settingsData, journalSummary, waRaw] = await Promise.all([
          // Dibaca terus (lepas dari WATCHLIST_SHEET_ENABLED) karena sekarang
          // juga dipakai buat mencocokkan tanggal sinyal WA dengan tanggal
          // Watchlist-nya, bukan cuma sebagai sumber sinyal aktif.
          getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token).catch(() => []),
          getSettings(token, resolvedSheetId),
          // Satu request buat count/journaledStocks/investedCapital sekaligus,
          // bukan 3 request terpisah ke range jurnal yang sama persis.
          getActiveJournalSummary(token, resolvedSheetId),
          getWaSignalRows(token, resolvedSheetId),
        ]);
        if (cancelled) return;
        const { activeCount: occupiedSlots, journaledStocks: journaled, investedCapital: invested } = journalSummary;
        setSettings(settingsData);
        setInvestedCapital(invested);
        setJournaledStocks(journaled);
        setUsedSlots(occupiedSlots);
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
            localStorage.removeItem(LEGACY_WA_STORAGE_KEY);
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

        const remainingCapital = Math.max(settingsData.capital - invested, 0);
        const ranked = rankSignals(combined, {
          capital: settingsData.capital, riskPercent: settingsData.riskPercent, remainingCapital,
          maxSlots: settingsData.maxSlots, occupiedSlots, journaledStocks: journaled,
        });

        pruneStaleDismissals();
        const dismissedSet = new Set(getDismissedSignals());
        // Already-bought (journaled) and dismissed signals don't belong in
        // this list anymore - the journal/Rekapan tab is where owned
        // positions live, and a dismissed signal was explicitly hidden.
        setSignals(ranked.filter((s) => !s.owned && !dismissedSet.has(s.stock.toUpperCase())));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  function openRecordForm(s, pos) {
    setRecordingStock(s.stock);
    setFillPrice(String(s.entry));
    setFillLot(pos ? String(Math.round(pos.lembar / 100)) : '');
    setOrderFilled(true);
    setSaveError(null);
  }

  function closeRecordForm() {
    setRecordingStock(null);
    setSaveError(null);
  }

  async function submitRecord(s) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const row = [
        // Leading "'" forces Sheets to keep this as literal text instead of
        // silently converting "03-08-2026" into a date serial number (46237).
        `'${todayDDMMYYYY()}`, s.stock, Number(fillPrice) || s.entry, s.sl, s.tp1, s.tp2 || '',
        orderFilled ? 'RUNNING' : 'PENDING', '', '', `Lot: ${fillLot || '-'}`, s.tradeType || '',
      ];
      await appendValues(sheetId, 'DayTrade_Journal!A:K', [row], token);
      setRecordingStock(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
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
        mmPercent: s.mmPercent ? Number(s.mmPercent) : null,
        capturedAt: new Date().toISOString(),
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
    capital, maxSlots, entryMode, tpMode,
  }) {
    setSettingsSaving(true);
    try {
      await updateSettings(token, sheetId, {
        capital, maxSlots, entryMode, tpMode,
      });
      setSettingsOpen(false);
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

  function openEditEntry(s) {
    setEditingEntryStock(s.stock);
    setEntryInput(String(s.entry));
    setEntryError(null);
  }

  function closeEditEntry() {
    setEditingEntryStock(null);
    setEntryInput('');
    setEntryError(null);
  }

  // Editing the entry price shifts buyLow/buyHigh by the same delta instead
  // of collapsing them down to a single number or storing a separate
  // override field - the midpoint-of-range rule that computes `entry`
  // elsewhere stays the single source of truth (so position sizing, the
  // range bar, etc. don't need special-casing), AND the original buy range
  // width is preserved so "605-630" style context keeps showing under the
  // entry, just recentered on the price the user actually typed.
  async function submitEditEntry(s) {
    const newEntry = Number(entryInput);
    if (!newEntry || newEntry <= 0) {
      setEntryError('Harga entry tidak valid');
      return;
    }
    const delta = newEntry - s.entry;
    setEntrySaving(true);
    setEntryError(null);
    try {
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
      }]);
      closeEditEntry();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setEntryError(e.message);
    } finally {
      setEntrySaving(false);
    }
  }

  if (!token) {
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

  const remainingCapital = settings ? Math.max(settings.capital - investedCapital, 0) : null;
  // No date split anymore - a signal stays listed for as long as it's still
  // OPEN/valid in the sheet, not just on the day it was first published.
  // Not-skipped candidates first, then best score first.
  const sortBest = (a, b) => (Number(a.willSkip) - Number(b.willSkip)) || (b.score - a.score);
  const sortedSignals = [...signals].sort(sortBest);
  const dayTradeSignals = sortedSignals.filter((s) => s.tradeType === 'DAY TRADE');
  const swingTradeSignals = sortedSignals.filter((s) => s.tradeType === 'SWING TRADE');

  function renderCard(s, isSpotlight) {
    const pos = s.position || null;
    const cardKey = s.stock + s.status;
    return (
      <div key={cardKey} className={`card ${s.willSkip ? 'skip-card' : ''} ${isSpotlight ? 'spotlight' : ''}`}>
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <span className="ticker">{s.stock}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {s.willSkip && s.skipReason === 'modal-habis' && (
              <span className="badge badge-warning">skip · modal habis</span>
            )}
            <span className="score-chip">
              <span className="score-num">{s.score.toFixed(1)}</span>
              <span className="score-lbl">skor</span>
            </span>
            <TradingViewButton onClick={() => toggleTv(cardKey)} active={tvOpen.has(cardKey)} />
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => copyOne(s)}>
              copy
            </button>
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => hapusSignal(s)}>
              hapus
            </button>
          </div>
        </div>
        {tvOpen.has(cardKey) && (
          <div style={{ marginTop: 8 }}>
            <TradingViewQuote stock={s.stock} />
          </div>
        )}
        {s.ageDays !== null && (
          <p className="muted" style={{ marginTop: 4 }}>
            {s.ageDays === 0 ? 'Terbit hari ini' : `Terbit ${s.ageDays} hari lalu`}
          </p>
        )}
        {s.detailStatus && (
          <p className="muted" style={{ marginTop: 2, lineHeight: 1.45 }}>{s.detailStatus}</p>
        )}
        {s.waitFor && (
          <p className="muted">Tunggu turun ke {s.waitFor} sebelum entry</p>
        )}
        {s.estimatedEntry && (
          <p className="muted">Entry estimasi - cek harga live sebelum eksekusi</p>
        )}
        <>
          {(() => {
            const rb = buildRangeBar(s.sl, s.entry, s.tp1, s.tp2);
            return (
              <div className="range-bar">
                <div className="range-seg sl" style={{ flex: rb.slFlex }} />
                <div className="range-seg mid" style={{ flex: rb.midFlex }} />
                <div className="range-seg tp" style={{ flex: rb.tpFlex }} />
                <div className="range-seg tp-beyond" style={{ flex: rb.beyondFlex }} />
                <div className="range-marker" style={{ left: `${rb.markerPercent}%` }} />
              </div>
            );
          })()}
          <div className="range-labels">
            <div className="range-label sl">
              <span className="metric-label">SL</span>
              <div className="metric-value">{s.sl?.toLocaleString('id-ID')}</div>
              {pos && pos.lembar > 0 && (
                <div className="metric-sub">-{formatRupiah((s.entry - s.sl) * pos.lembar)}</div>
              )}
            </div>
            <div className="range-label">
              <span className="metric-label">Entry</span>
              {editingEntryStock === s.stock ? (
                <div className="entry-edit">
                  <input
                    type="number"
                    className="entry-edit-input"
                    value={entryInput}
                    onChange={(e) => setEntryInput(e.target.value)}
                    autoFocus
                  />
                  <div className="entry-edit-actions">
                    <button
                      type="button"
                      className="icon-btn-sm"
                      onClick={() => submitEditEntry(s)}
                      disabled={entrySaving}
                      aria-label="Simpan entry"
                    >
                      {entrySaving ? '…' : '✓'}
                    </button>
                    <button
                      type="button"
                      className="icon-btn-sm"
                      onClick={closeEditEntry}
                      disabled={entrySaving}
                      aria-label="Batal edit entry"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <div className="metric-value entry-value-row">
                  {s.entry.toLocaleString('id-ID')}
                  {s.source === 'wa' && (
                    <button
                      type="button"
                      className="entry-edit-btn"
                      onClick={() => openEditEntry(s)}
                      aria-label="Edit harga entry"
                    >
                      ✎
                    </button>
                  )}
                </div>
              )}
              {editingEntryStock === s.stock && entryError && (
                <div className="metric-sub text-danger">{entryError}</div>
              )}
              {editingEntryStock !== s.stock && s.buyLow != null && s.buyHigh != null && s.buyLow !== s.buyHigh && (
                <div className="metric-sub muted">
                  {s.buyLow.toLocaleString('id-ID')}-{s.buyHigh.toLocaleString('id-ID')}
                </div>
              )}
            </div>
            {settings && settings.tpMode === 'separate' ? (
              <>
                <div className="range-label tp">
                  <span className="metric-label">TP1</span>
                  <div className="metric-value">{s.tp1?.toLocaleString('id-ID')}</div>
                  {pos && pos.lembar > 0 && (
                    <div className="metric-sub">+{formatRupiah((s.tp1 - s.entry) * pos.lembar)}</div>
                  )}
                </div>
                {s.tp2 != null && (
                  <div className="range-label tp">
                    <span className="metric-label">TP2</span>
                    <div className="metric-value">{s.tp2.toLocaleString('id-ID')}</div>
                    {pos && pos.lembar > 0 && (
                      <div className="metric-sub">+{formatRupiah((s.tp2 - s.entry) * pos.lembar)}</div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="range-label tp">
                <span className="metric-label">TP</span>
                <div className="metric-value">{s.tpMid.toLocaleString('id-ID')}</div>
                {pos && pos.lembar > 0 && (
                  <div className="metric-sub">+{formatRupiah((s.tpMid - s.entry) * pos.lembar)}</div>
                )}
                {/* TP1/TP2 kept as small reference text under the combined TP
                    value above (which is their midpoint, see computeScore in
                    lib/scoring.js) - the big number is what's used for the
                    score, but the individual targets are still worth knowing. */}
                <div className="metric-sub muted">
                  TP1 {s.tp1?.toLocaleString('id-ID')}
                  {s.tp2 != null && <> · TP2 {s.tp2.toLocaleString('id-ID')}</>}
                </div>
              </div>
            )}
          </div>
          {s.tp3 != null && (
            <p className="muted" style={{ marginTop: 4 }}>TP3: {s.tp3.toLocaleString('id-ID')}</p>
          )}
          {s.isOpen && pos && pos.rupiah > 0 && (
            <div className="position-box">
              <div className="pb-row">
                <span className="muted">Saran posisi</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {formatRupiah(pos.rupiah)} <span className="muted" style={{ fontWeight: 500 }}>· {Math.round(pos.lembar / 100)} lot</span>
                </span>
              </div>
              {s.adjusted && (
                <span className="pb-note">⚠ Lot dikurangi dari saran normal, disesuaikan sisa modal</span>
              )}
            </div>
          )}
        </>

        {s.isOpen && !s.willSkip && recordingStock !== s.stock && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => openRecordForm(s, pos)}>
              Catat order ke jurnal
            </button>
          </div>
        )}

        {recordingStock === s.stock && (
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <p className="muted" style={{ marginBottom: 4 }}>Harga beli {orderFilled ? 'aktual' : 'yang dipasang'}</p>
            <input
              type="number"
              value={fillPrice}
              onChange={(e) => setFillPrice(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <p className="muted" style={{ marginBottom: 4 }}>Jumlah (lot)</p>
            <input
              type="number"
              value={fillLot}
              onChange={(e) => setFillLot(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <p className="muted" style={{ marginBottom: 4 }}>Status order</p>
            <div className="segmented" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className={`seg-btn ${orderFilled ? 'active' : ''}`}
                onClick={() => setOrderFilled(true)}
              >
                Sudah ke-fill
              </button>
              <button
                type="button"
                className={`seg-btn ${!orderFilled ? 'active' : ''}`}
                onClick={() => setOrderFilled(false)}
              >
                Baru dipasang, belum fill
              </button>
            </div>
            {!orderFilled && (
              <p className="muted" style={{ marginBottom: 8 }}>
                Dana akan dikunci di kalkulasi modal/slot, tapi belum dihitung sebagai posisi berjalan sampai dikonfirmasi fill di Rekapan.
              </p>
            )}
            {saveError && <p className="muted text-danger">{saveError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={closeRecordForm} disabled={saving}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => submitRecord(s)}
                disabled={saving}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

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
              <div>
                <p className="muted" style={{ marginBottom: 4 }}>MM %</p>
                <input type="number" value={s.mmPercent || ''} onChange={(e) => updateWaReviewField(i, 'mmPercent', e.target.value)} />
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
                <div className="sub-box-value">{formatRupiah(settings.capital)}</div>
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
        maxSlots={settings ? settings.maxSlots : 0}
        entryMode={settings ? settings.entryMode : 'mid'}
        tpMode={settings ? settings.tpMode : 'mid'}
        onSave={saveSettings}
        saving={settingsSaving}
      />

      <div
        ref={waPasteZoneRef}
        contentEditable
        suppressContentEditableWarning
        onPaste={handleWaPasteZone}
        className="wa-paste-zone"
      >
        {waExtracting ? 'Membaca sinyal baru...' : 'Tempel sinyal baru'}
      </div>
      {waExtractError && <p className="muted text-danger">{waExtractError}</p>}

      {loading && <p className="muted">Memuat sinyal...</p>}
      {error && <p className="muted text-danger">{error}</p>}

      {!loading && signals.length === 0 && !error && (
        <p className="muted">Belum ada sinyal baru hari ini.</p>
      )}

      <p style={{ marginTop: 8, marginBottom: 8, fontWeight: 600 }}>Day Trade</p>
      {dayTradeSignals.length === 0 && <p className="muted">Belum ada sinyal day trade hari ini.</p>}
      {dayTradeSignals.map((s, i) => renderCard(s, i === 0 && !s.willSkip))}

      <p style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>Swing Trade</p>
      {swingTradeSignals.length === 0 && <p className="muted">Belum ada sinyal swing trade hari ini.</p>}
      {swingTradeSignals.map((s, i) => renderCard(s, i === 0 && !s.willSkip))}

      <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={() => { signOut(); setToken(null); }}>
        Keluar
      </button>
    </div>
  );
}
