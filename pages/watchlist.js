import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getAccessToken, getStoredToken } from '../lib/auth';
import {
  getValues, WATCHLIST_SHEET_ID, WATCHLIST_RANGE,
  getOrCreateAppDataSheetId, ensureSheetsInitialized, addWaSignalRows, getWaSignalRows, getJournaledStocks,
} from '../lib/sheets';
import {
  parseWatchlistRowsRaw, parseRange, parsePriceWithPercent, parseIndoNumber, parseSheetDate,
} from '../lib/scoring';

const STATUS_BADGE = {
  RUNNING: { cls: 'badge badge-success', label: 'running' },
  OPEN: { cls: 'badge', label: 'open' },
  PENDING: { cls: 'badge badge-warning', label: 'pending' },
};

// "Semua" isn't a real filter key - it's just what an empty selection means
// (rendered as its own chip since "nothing selected" isn't obvious as a
// clickable state on its own).
//
// Each filter belongs to a "group" - status order vs. sudah-diproses-atau-
// belum. Filters picked from the SAME group are OR'd together (a row can
// only be OPEN or RUNNING at once, so picking both means "either"), but
// filters from DIFFERENT groups are AND'd (picking "Open" + "Belum diproses"
// means open AND untouched, not open-or-untouched).
const FILTERS = [
  { key: 'OPEN', label: 'Open', group: 'status' },
  { key: 'RUNNING', label: 'Running', group: 'status' },
  { key: 'PENDING', label: 'Pending', group: 'status' },
  { key: 'REKAPAN', label: 'Sudah di rekapan', group: 'proses' },
  { key: 'SINYAL', label: 'Sudah di sinyal', group: 'proses' },
  { key: 'BELUM', label: 'Belum diproses', group: 'proses' },
];

// Single-filter predicate, reused both when testing one filter key in
// isolation and when OR-ing filters within the same group below.
function matchesOneFilter(r, filterKey, existingElsewhereBadge) {
  if (filterKey === 'OPEN' || filterKey === 'RUNNING' || filterKey === 'PENDING') return r.status === filterKey;
  const badge = existingElsewhereBadge(r);
  if (filterKey === 'REKAPAN') return badge?.label === 'sudah di rekapan';
  if (filterKey === 'SINYAL') return badge?.label === 'sudah di sinyal';
  if (filterKey === 'BELUM') return !badge;
  return true;
}

// A row passes if, for every group that has at least one filter selected,
// it matches at least one of that group's selected filters (OR within
// group, AND across groups). A group with nothing selected imposes no
// constraint.
function matchesSelectedFilters(r, selectedKeys, existingElsewhereBadge) {
  if (selectedKeys.size === 0) return true;
  const selectedByGroup = new Map();
  for (const f of FILTERS) {
    if (!selectedKeys.has(f.key)) continue;
    if (!selectedByGroup.has(f.group)) selectedByGroup.set(f.group, []);
    selectedByGroup.get(f.group).push(f.key);
  }
  return [...selectedByGroup.values()].every(
    (keys) => keys.some((k) => matchesOneFilter(r, k, existingElsewhereBadge))
  );
}

// "-" is the source sheet's own empty-cell placeholder (e.g. a DAY TRADE
// row with no TP2/TP3) - treat that the same as a blank cell.
const has = (v) => v && v !== '-';

// Same prompt style as the "copy" button in Sinyal, built from the
// watchlist row's own already-formatted strings (buyPrice/sl/tp1 already
// read like "1850 (-8.42%)") instead of recomputing entry/percent - this
// page doesn't run the ranking math Sinyal does.
function buildAiPromptFromRow(r) {
  const range = has(r.buyPrice) ? `range beli ${r.buyPrice}, ` : '';
  const sl = has(r.sl) ? `SL ${r.sl}` : '';
  const tp1 = has(r.tp1) ? `, TP1 ${r.tp1}` : '';
  return `Tolong analisa saham berikut, kasih tau trennya kemana, peluang naiknya, dan menurut kamu sebaiknya entry di harga berapa dari range yang tersedia:\n\n${r.stock}: ${range}${sl}${tp1}`;
}

// Same key used for the React list key and for tracking checkbox selection -
// stock alone isn't unique enough (a stock can reappear across refreshes
// with a different date), so pair it with the row's own date.
const rowKey = (r) => `${r.stock}-${r.date}`;

export default function WatchlistPage() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordingStock, setRecordingStock] = useState(null);
  const [recordError, setRecordError] = useState(null);
  const [sheetId, setSheetId] = useState(null);
  const [waStocks, setWaStocks] = useState(new Set());
  const [journaledStocks, setJournaledStocks] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [batchRecording, setBatchRecording] = useState(false);
  const [statusFilters, setStatusFilters] = useState(new Set());

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
        const [rawRows, waRows, journaled] = await Promise.all([
          getValues(WATCHLIST_SHEET_ID, WATCHLIST_RANGE, token),
          getWaSignalRows(token, resolvedSheetId),
          getJournaledStocks(token, resolvedSheetId),
        ]);
        if (cancelled) return;
        setRows(parseWatchlistRowsRaw(rawRows));
        setWaStocks(new Set(waRows.map((s) => s.stock.toUpperCase())));
        setJournaledStocks(journaled);
        setSelected(new Set());
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey]);

  if (!token) {
    return (
      <div className="center-box">
        <div className="login-icon">📈</div>
        <h1 className="login-title">Watchlist</h1>
        <p className="login-sub">Masuk dengan akun Google untuk melihat data watchlist.</p>
        <button className="btn btn-primary login-btn" onClick={handleSignIn}>Sign in dengan Google</button>
        {error && <p className="muted text-danger" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  // Terbaru dulu di tiap kelompok - baris yang tanggalnya tidak kebaca
  // (format aneh/kosong) ditaruh paling bawah alih-alih ikut acak ketutup
  // urutan asli sheet.
  const sortedRows = [...rows].sort((a, b) => {
    const dateA = parseSheetDate(a.date);
    const dateB = parseSheetDate(b.date);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
  });
  // Empty selection = "Semua" (no filtering). Otherwise see
  // matchesSelectedFilters - OR within a group (status, or sudah-diproses),
  // AND across groups: "Open" + "Belum diproses" together means open AND
  // untouched, not open-or-untouched.
  const filteredRows = sortedRows.filter((r) => matchesSelectedFilters(r, statusFilters, existingElsewhereBadge));
  const dayTradeRows = filteredRows.filter((r) => r.tradeType === 'DAY TRADE');
  const swingTradeRows = filteredRows.filter((r) => r.tradeType === 'SWING TRADE');
  const otherRows = filteredRows.filter((r) => r.tradeType !== 'DAY TRADE' && r.tradeType !== 'SWING TRADE');

  function toggleFilter(key) {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Turns a watchlist row into a proper WA signal (same shape/sheet as a
  // pasted WA screenshot) - "catat" means "bring this into Sinyal", not
  // "log a completed trade" (that's still "Catat order ke jurnal" over
  // there). Throws with a user-facing message when the row's price data
  // is too incomplete to build a signal from.
  function buildSignalFromRow(r) {
    const range = parseRange(r.buyPrice);
    const sl = parsePriceWithPercent(r.sl).price;
    const tp1 = parsePriceWithPercent(r.tp1).price;
    const tp2 = has(r.tp2) ? parsePriceWithPercent(r.tp2).price : null;
    const mmPercent = has(r.mmPercent) ? parseIndoNumber(r.mmPercent) : null;
    if (range.low == null || range.high == null || sl == null || tp1 == null) {
      throw new Error(`Data harga ${r.stock} tidak lengkap, tidak bisa dicatat sebagai sinyal.`);
    }
    return {
      stock: r.stock,
      tradeType: r.tradeType === 'SWING TRADE' ? 'SWING TRADE' : 'DAY TRADE',
      buyLow: range.low,
      buyHigh: range.high,
      sl,
      tp1,
      tp2,
      mmPercent,
      // Pakai tanggal aslinya dari watchlist, bukan waktu klik "catat" -
      // biar tanggal di Sinyal sama dengan yang tertulis di Watchlist.
      capturedAt: (parseSheetDate(r.date) || new Date()).toISOString(),
    };
  }

  async function resolveSheetId() {
    if (sheetId) return sheetId;
    const resolved = await getOrCreateAppDataSheetId(token);
    setSheetId(resolved);
    return resolved;
  }

  async function catatRow(r) {
    setRecordingStock(r.stock);
    setRecordError(null);
    try {
      const signal = buildSignalFromRow(r);
      const resolvedSheetId = await resolveSheetId();
      await ensureSheetsInitialized(token, resolvedSheetId);
      await addWaSignalRows(token, resolvedSheetId, [signal]);
      router.push('/');
    } catch (e) {
      setRecordError(e.message);
      setRecordingStock(null);
    }
  }

  // Batch version of catatRow: records every checked row in one
  // read-modify-write (addWaSignalRows already batches), so picking 5
  // stocks doesn't fire 5 separate sheet writes. Rows with incomplete price
  // data are skipped and reported, but valid ones still get recorded rather
  // than the whole batch failing over one bad row.
  async function catatSelected() {
    const chosen = rows.filter((r) => selected.has(rowKey(r)));
    if (chosen.length === 0) return;
    setBatchRecording(true);
    setRecordError(null);
    const signals = [];
    const failedStocks = [];
    for (const r of chosen) {
      try {
        signals.push(buildSignalFromRow(r));
      } catch {
        failedStocks.push(r.stock);
      }
    }
    try {
      if (signals.length > 0) {
        const resolvedSheetId = await resolveSheetId();
        await ensureSheetsInitialized(token, resolvedSheetId);
        await addWaSignalRows(token, resolvedSheetId, signals);
      }
      if (failedStocks.length > 0) {
        setRecordError(`Data tidak lengkap, dilewati: ${failedStocks.join(', ')}`);
        setSelected(new Set(chosen.filter((r) => failedStocks.includes(r.stock)).map(rowKey)));
        setBatchRecording(false);
      } else {
        router.push('/');
      }
    } catch (e) {
      setRecordError(e.message);
      setBatchRecording(false);
    }
  }

  function copyRow(r) {
    navigator.clipboard.writeText(buildAiPromptFromRow(r));
  }

  function toggleSelect(r) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = rowKey(r);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Tells the user this stock has already moved past "just watching" -
  // either brought into Sinyal via "catat"/WA, or already bought and
  // sitting in Rekapan - so they don't catat the same thing twice.
  function existingElsewhereBadge(r) {
    const stock = r.stock.toUpperCase();
    if (journaledStocks.has(stock)) return { cls: 'badge badge-success', label: 'sudah di rekapan' };
    if (waStocks.has(stock)) return { cls: 'badge', label: 'sudah di sinyal' };
    return null;
  }

  function renderRow(r) {
    const badge = STATUS_BADGE[r.status] || (r.status ? { cls: 'badge', label: r.status.toLowerCase() } : null);
    const existing = existingElsewhereBadge(r);
    const key = rowKey(r);
    return (
      <div key={key} className="card">
        <div className="card-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={selected.has(key)}
              onChange={() => toggleSelect(r)}
              aria-label={`Pilih ${r.stock}`}
            />
            <span className="ticker">{r.stock}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {badge && <span className={badge.cls}>{badge.label}</span>}
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => copyRow(r)}>
              copy
            </button>
            <button
              className="btn"
              style={{ padding: '4px 8px' }}
              onClick={() => catatRow(r)}
              disabled={recordingStock === r.stock || batchRecording}
            >
              {recordingStock === r.stock ? 'Mencatat...' : 'catat'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{r.date}</p>
        <p className="muted" style={{ marginTop: 2 }}>
          Buy {has(r.buyPrice) ? r.buyPrice : '-'}{has(r.lastPrice) && ` · Last ${r.lastPrice}`}
        </p>
        <p className="muted" style={{ marginTop: 2 }}>
          SL <span className="text-danger">{has(r.sl) ? r.sl : '-'}</span>
          {has(r.tp1) && <> {' · '}TP1 <span className="text-success">{r.tp1}</span></>}
          {has(r.tp2) && <> {' · '}TP2 <span className="text-success">{r.tp2}</span></>}
          {has(r.tp3) && <> {' · '}TP3 <span className="text-success">{r.tp3}</span></>}
        </p>
        {r.detailStatus && <p className="muted" style={{ marginTop: 2 }}>{r.detailStatus}</p>}
        {r.mmPercent && <p className="muted" style={{ marginTop: 2 }}>MM: {r.mmPercent}</p>}
        {existing && (
          <span className={`${existing.cls} badge-sm`} style={{ position: 'absolute', right: 15, bottom: 12 }}>
            {existing.label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <h1 className="page-title">Watchlist</h1>
          <button className="btn icon-btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} aria-label="Muat ulang">
            &#8635;
          </button>
        </div>
        <p className="page-sub">
          Data mentah dari sheet sumber - cuma buat dilihat, tidak memengaruhi Sinyal.
        </p>
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="filter-chips">
          <button
            type="button"
            className={`filter-chip ${statusFilters.size === 0 ? 'active' : ''}`}
            onClick={() => setStatusFilters(new Set())}
          >
            Semua
          </button>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-chip ${statusFilters.has(f.key) ? 'active' : ''}`}
              onClick={() => toggleFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{selected.size} saham dipilih</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setSelected(new Set())} disabled={batchRecording}>
              Batal
            </button>
            <button className="btn btn-primary" onClick={catatSelected} disabled={batchRecording}>
              {batchRecording ? 'Mencatat...' : `Catat ${selected.size} saham`}
            </button>
          </div>
        </div>
      )}

      {loading && <p className="muted">Memuat...</p>}
      {error && <p className="muted text-danger">{error}</p>}
      {recordError && <p className="muted text-danger">{recordError}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="muted">Tidak ada data di watchlist.</p>
      )}
      {!loading && !error && rows.length > 0 && filteredRows.length === 0 && (
        <p className="muted">Tidak ada saham yang cocok dengan filter ini.</p>
      )}

      {dayTradeRows.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 10px' }}>Day Trade</h2>
          {dayTradeRows.map(renderRow)}
        </>
      )}

      {swingTradeRows.length > 0 && (
        <>
          <h2 style={{ margin: '16px 0 10px' }}>Swing Trade</h2>
          {swingTradeRows.map(renderRow)}
        </>
      )}

      {otherRows.length > 0 && (
        <>
          <h2 style={{ margin: '16px 0 10px' }}>Lainnya</h2>
          {otherRows.map(renderRow)}
        </>
      )}
    </div>
  );
}
