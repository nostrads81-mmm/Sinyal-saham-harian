import { computeTpMid } from '../lib/scoring';
import TradingViewQuote from './TradingViewQuote';
import TradingViewButton from './TradingViewButton';

// One open position in Rekapan, shaped like the Sinyal card on purpose: same
// header + three-price grid, same "everything else waits for a tap" rule, same
// ⋯ menu for the rare/destructive actions. Two tabs that list trades should not
// need two different reading habits.
//
// State stays in the page (which card's form is open, what was typed) and is
// handed down: the page already needs it to gate its own fetches, and keeping
// it there means this component stays a pure function of its props - which is
// what makes it testable by rendering it, with no React Testing Library.
export default function PositionCard({
  entry: e, settings, badge, lot, ui, actions,
}) {
  const separateTp = settings.tpMode === 'separate';
  const tpValue = separateTp ? e.tp1 : (e.tp1 != null ? computeTpMid(e.tp1, e.tp2) : null);
  const isPending = e.status === 'PENDING';

  return (
    <div className="card signal-card">
      <button
        type="button"
        className="signal-head"
        onClick={actions.onToggleExpand}
        aria-expanded={ui.expanded}
      >
        <span className="signal-head-left">
          <span className="ticker">{e.stock}</span>
          {e.tag && <span className="badge badge-sm">{e.tag}</span>}
        </span>
        <span className="signal-head-right">
          <span className={badge.cls}>{badge.label}</span>
          <span className={`chev ${ui.expanded ? 'open' : ''}`} aria-hidden="true">▾</span>
        </span>
      </button>

      <div className="metric-grid">
        <div className="metric-cell">
          <span className="metric-label">Entry</span>
          <div className="metric-value">{e.entry?.toLocaleString('id-ID') || '-'}</div>
          <div className="metric-sub muted">{lot ? `${lot} lot` : '- lot'}</div>
        </div>
        <div className="metric-cell">
          <span className="metric-label">SL</span>
          <div className="metric-value text-danger">{e.sl?.toLocaleString('id-ID') || '-'}</div>
        </div>
        <div className="metric-cell">
          <span className="metric-label">{separateTp ? 'TP1' : 'TP'}</span>
          <div className="metric-value text-success">{tpValue != null ? tpValue.toLocaleString('id-ID') : '-'}</div>
        </div>
      </div>

      <div className="card-actions">
        {isPending && !ui.confirming && (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={actions.onStartConfirm}>
            Konfirmasi fill
          </button>
        )}
        {!isPending && !ui.closing && (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={actions.onStartClose}>
            Tutup posisi
          </button>
        )}
        <button
          type="button"
          className="btn icon-btn"
          onClick={actions.onToggleMenu}
          aria-label="Menu lain"
          aria-expanded={ui.menuOpen}
        >
          ⋯
        </button>
      </div>

      {/* "Batalkan order" deletes the journal row outright, so it sits behind
          the ⋯ instead of next to "Konfirmasi fill". */}
      {ui.menuOpen && (
        <div className="signal-menu">
          <TradingViewButton onClick={actions.onToggleTv} active={ui.tvOpen} />
          {isPending && (
            <button className="btn btn-danger" onClick={actions.onCancelOrder} disabled={ui.cancelling}>
              Batalkan order
            </button>
          )}
        </div>
      )}

      {ui.tvOpen && (
        <div style={{ marginTop: 8 }}>
          <TradingViewQuote stock={e.stock} />
        </div>
      )}

      {ui.expanded && (
        <div className="detail-block">
          <p className="muted">Dibeli {e.tanggalEntry}</p>
          {isPending && (
            <p className="muted" style={{ marginTop: 2 }}>
              Dana sudah dihitung terkunci di modal/slot, tapi posisi belum aktif sampai order ke-fill di broker.
            </p>
          )}
          {separateTp && e.tp2 != null && (
            <p className="muted" style={{ marginTop: 2 }}>
              TP2 <span className="text-success">{e.tp2.toLocaleString('id-ID')}</span>
            </p>
          )}
          {!separateTp && e.tp1 != null && (
            <p className="muted" style={{ marginTop: 2 }}>
              TP1 <span className="text-success">{e.tp1.toLocaleString('id-ID')}</span>
              {e.tp2 != null && <> · TP2 <span className="text-success">{e.tp2.toLocaleString('id-ID')}</span></>}
            </p>
          )}
        </div>
      )}

      {ui.confirming && (
        <div className="detail-block" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <p className="muted" style={{ marginBottom: 4 }}>Harga fill aktual</p>
          <input
            type="number"
            value={ui.confirmPrice}
            onChange={(ev) => actions.onConfirmPriceChange(ev.target.value)}
            style={{ marginBottom: 8 }}
          />
          <p className="muted" style={{ marginBottom: 4 }}>Jumlah (lot)</p>
          <input
            type="number"
            value={ui.confirmLot}
            onChange={(ev) => actions.onConfirmLotChange(ev.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={actions.onCancelForm} disabled={ui.saving}>
              Batal
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={actions.onSubmitConfirm} disabled={ui.saving}>
              {ui.saving ? 'Menyimpan...' : 'Sudah ke-fill'}
            </button>
          </div>
        </div>
      )}

      {ui.closing && (
        <div className="detail-block" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <p className="muted" style={{ marginBottom: 4 }}>Harga exit</p>
          <input
            type="number"
            value={ui.exitPrice}
            onChange={(ev) => actions.onExitPriceChange(ev.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={actions.onCancelForm} disabled={ui.saving}>
              Batal
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={actions.onSubmitClose}
              disabled={ui.saving || !ui.exitPrice}
            >
              {ui.saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
