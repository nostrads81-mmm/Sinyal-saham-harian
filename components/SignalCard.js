import { useState } from 'react';
import { formatRupiah, formatRupiahRingkas } from '../lib/format';
import { parseHargaInput, parseLotInput } from '../lib/journalInput';
import TradingViewQuote from './TradingViewQuote';
import TradingViewButton from './TradingViewButton';

// Segment widths (as flex-grow numbers) for the SL-entry-TP1-TP2 price range
// bar, proportional to the actual price gaps so the bar visually reflects how
// far each level sits from the others, not just evenly-spaced ticks. A
// decorative "beyond TP" filler segment is appended so the bar doesn't end
// abruptly right at the last known target.
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

const SKIP_BADGES = {
  'modal-habis': 'skip · modal habis',
  'dilewati-manual': 'dilewati manual',
};

// One signal, in two levels:
// - collapsed (default): ticker, score, the three prices that matter (entry,
//   SL, TP) and the suggested size - enough to judge a signal without opening
//   anything, which is what makes several cards scannable at once.
// - expanded (tap): the range bar, per-level rupiah impact, TP2/TP3, MM, signal
//   age, why the lot was capped, and the live chart.
// The forms a card owns (record order, edit entry) live here rather than in the
// page: they belong to one signal, and keeping them local means the page no
// longer needs eight pieces of state to describe "which card is open".
export default function SignalCard({
  signal: s, settings, spotlight, tvOpen,
  onCopy, onToggleTv, onToggleSkip, onRemove, onSaveRecord, onSaveEntry,
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordPrice, setRecordPrice] = useState('');
  const [recordLot, setRecordLot] = useState('');
  const [recordFilled, setRecordFilled] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordError, setRecordError] = useState(null);
  const [entryEdit, setEntryEdit] = useState(false);
  const [entryInput, setEntryInput] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState(null);

  const pos = s.position || null;
  const separateTp = settings && settings.tpMode === 'separate';
  const mainTp = separateTp ? s.tp1 : s.tpMid;

  function openRecordForm() {
    setRecordPrice(String(s.entry));
    setRecordLot(pos ? String(Math.round(pos.lembar / 100)) : '');
    setRecordFilled(false);
    setRecordError(null);
    setRecordOpen(true);
    setMenuOpen(false);
  }

  async function submitRecordForm() {
    const price = parseHargaInput(recordPrice);
    const lot = parseLotInput(recordLot);
    if (price.error || lot.error) {
      setRecordError(price.error || lot.error);
      return;
    }
    setRecordSaving(true);
    setRecordError(null);
    try {
      await onSaveRecord(s, { price: price.value ?? s.entry, lot: lot.value, filled: recordFilled });
      setRecordOpen(false);
    } catch (e) {
      setRecordError(e.message);
    } finally {
      setRecordSaving(false);
    }
  }

  function openEntryEdit() {
    setEntryInput(String(s.entry));
    setEntryError(null);
    setEntryEdit(true);
  }

  async function submitEntryEdit() {
    const next = parseHargaInput(entryInput);
    if (next.error || next.value === null) {
      setEntryError(next.error || 'Harga entry tidak valid');
      return;
    }
    setEntrySaving(true);
    setEntryError(null);
    try {
      await onSaveEntry(s, next.value);
      setEntryEdit(false);
    } catch (e) {
      setEntryError(e.message);
    } finally {
      setEntrySaving(false);
    }
  }

  return (
    <div className={`card signal-card ${s.willSkip ? 'skip-card' : ''} ${spotlight ? 'spotlight' : ''}`}>
      {/* The header row is the tap target for the detail view, so nothing in
          here is a button that would swallow the tap. */}
      <button
        type="button"
        className="signal-head"
        onClick={() => { setExpanded((v) => !v); setMenuOpen(false); }}
        aria-expanded={expanded}
      >
        <span className="signal-head-left">
          <span className="ticker">{s.stock}</span>
          {s.tag && <span className="badge badge-sm">{s.tag}</span>}
        </span>
        <span className="signal-head-right">
          {s.willSkip && SKIP_BADGES[s.skipReason] && (
            <span className="badge badge-warning">{SKIP_BADGES[s.skipReason]}</span>
          )}
          <span className="score-chip">
            <span className="score-num">{s.score.toFixed(1)}</span>
            <span className="score-lbl">skor</span>
          </span>
          <span className={`chev ${expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
        </span>
      </button>

      {/* The three numbers a decision hangs on. Rupiah amounts stay short here
          so three cards still line up; the exact figures are in the detail. */}
      <div className="metric-grid">
        <div className="metric-cell">
          <span className="metric-label">Entry</span>
          {entryEdit ? (
            <div className="entry-edit">
              <input
                type="number"
                className="entry-edit-input"
                value={entryInput}
                onChange={(e) => setEntryInput(e.target.value)}
                autoFocus
              />
              <div className="entry-edit-actions">
                <button type="button" className="icon-btn-sm" onClick={submitEntryEdit} disabled={entrySaving} aria-label="Simpan entry">
                  {entrySaving ? '…' : '✓'}
                </button>
                <button type="button" className="icon-btn-sm" onClick={() => setEntryEdit(false)} disabled={entrySaving} aria-label="Batal edit entry">
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <div className="metric-value metric-value-row">
              {s.entry.toLocaleString('id-ID')}
              {s.source === 'wa' && (
                <button type="button" className="entry-edit-btn" onClick={openEntryEdit} aria-label="Edit harga entry">
                  ✎
                </button>
              )}
            </div>
          )}
          {entryError && <div className="metric-sub text-danger">{entryError}</div>}
          {!entryEdit && s.buyLow != null && s.buyHigh != null && s.buyLow !== s.buyHigh && (
            <div className="metric-sub muted">{s.buyLow.toLocaleString('id-ID')}-{s.buyHigh.toLocaleString('id-ID')}</div>
          )}
        </div>

        <div className="metric-cell">
          <span className="metric-label">SL</span>
          <div className="metric-value">{s.sl?.toLocaleString('id-ID')}</div>
          {pos && pos.lembar > 0 && (
            <div className="metric-sub text-danger">-{formatRupiahRingkas((s.entry - s.sl) * pos.lembar)}</div>
          )}
        </div>

        <div className="metric-cell">
          <span className="metric-label">{separateTp ? 'TP1' : 'TP'}</span>
          <div className="metric-value">{mainTp?.toLocaleString('id-ID')}</div>
          {pos && pos.lembar > 0 && (
            <div className="metric-sub text-success">+{formatRupiahRingkas((mainTp - s.entry) * pos.lembar)}</div>
          )}
          {!separateTp && s.tp2 != null && (
            <div className="metric-sub muted">TP2 {s.tp2.toLocaleString('id-ID')}</div>
          )}
        </div>
      </div>

      {/* "How much should I buy" - the answer, short form. */}
      {s.isOpen && pos && pos.lembar > 0 && (
        <div className="pos-line">
          <span className="muted">Beli</span>
          <span className="pos-line-value">
            {formatRupiahRingkas(pos.rupiah)}
            <span className="muted"> · {Math.round(pos.lembar / 100)} lot</span>
          </span>
        </div>
      )}

      <div className="card-actions">
        {s.isOpen && !s.willSkip && (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={openRecordForm}>
            Catat order
          </button>
        )}
        <button className="btn" onClick={() => onCopy(s)}>copy</button>
        <button
          type="button"
          className="btn icon-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu lain"
          aria-expanded={menuOpen}
        >
          ⋯
        </button>
      </div>

      {/* Destructive and rarely-used actions live behind the ⋯ so they can't be
          hit while reaching for "copy", and so "hapus" isn't a stray tap away. */}
      {menuOpen && (
        <div className="signal-menu">
          <TradingViewButton onClick={onToggleTv} active={tvOpen} />
          {s.isOpen && (
            <button className="btn" onClick={() => { setMenuOpen(false); onToggleSkip(s); }}>
              {s.skipReason === 'dilewati-manual' ? 'batalkan skip' : 'skip'}
            </button>
          )}
          <button className="btn btn-danger" onClick={() => { setMenuOpen(false); onRemove(s); }}>
            hapus
          </button>
        </div>
      )}

      {tvOpen && (
        <div style={{ marginTop: 8 }}>
          <TradingViewQuote stock={s.stock} />
        </div>
      )}

      {expanded && (
        <div className="detail-block">
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
              <div className="metric-value">{s.entry.toLocaleString('id-ID')}</div>
            </div>
            {separateTp ? (
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
                <span className="pb-note">
                  {s.capReason === 'mm'
                    ? `⚠ Lot dibatasi MM maks ${formatRupiahRingkas(s.capRupiah)}`
                    : '⚠ Lot dikurangi dari saran normal, disesuaikan sisa modal'}
                </span>
              )}
            </div>
          )}

          {s.detailStatus && (
            <p className="muted" style={{ marginTop: 2, lineHeight: 1.45 }}>{s.detailStatus}</p>
          )}
          {s.waitFor && <p className="muted">Tunggu turun ke {s.waitFor} sebelum entry</p>}
          {s.estimatedEntry && <p className="muted">Entry estimasi - cek harga live sebelum eksekusi</p>}
          {s.ageDays != null && (
            <p className="muted">{s.ageDays === 0 ? 'Terbit hari ini' : `Terbit ${s.ageDays} hari lalu`}</p>
          )}
        </div>
      )}

      {recordOpen && (
        <div className="detail-block" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <p className="muted" style={{ marginBottom: 4 }}>Harga beli {recordFilled ? 'aktual' : 'yang dipasang'}</p>
          <input
            type="number"
            value={recordPrice}
            onChange={(e) => setRecordPrice(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <p className="muted" style={{ marginBottom: 4 }}>Jumlah (lot)</p>
          <input
            type="number"
            value={recordLot}
            onChange={(e) => setRecordLot(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <p className="muted" style={{ marginBottom: 4 }}>Status order</p>
          <div className="segmented" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={`seg-btn ${recordFilled ? 'active' : ''}`}
              onClick={() => setRecordFilled(true)}
            >
              Sudah ke-fill
            </button>
            <button
              type="button"
              className={`seg-btn ${!recordFilled ? 'active' : ''}`}
              onClick={() => setRecordFilled(false)}
            >
              Baru dipasang, belum fill
            </button>
          </div>
          {!recordFilled && (
            <p className="muted" style={{ marginBottom: 8 }}>
              Dana akan dikunci di kalkulasi modal/slot, tapi belum dihitung sebagai posisi berjalan sampai dikonfirmasi fill di Rekapan.
            </p>
          )}
          {recordError && <p className="muted text-danger">{recordError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setRecordOpen(false)} disabled={recordSaving}>
              Batal
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitRecordForm} disabled={recordSaving}>
              {recordSaving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}


    </div>
  );
}
