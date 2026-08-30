import { useState } from 'react';

const ACTION_LABEL = { BUY: 'Buy', WAIT: 'Wait', SELL: 'Sell' };
const ACTION_CLASS = { BUY: 'badge-success', WAIT: 'badge-warning', SELL: 'badge-danger' };

// Shown on both Sinyal and Watchlist cards - the action badge doubles as a
// toggle for the longer "kenapa" explanation, so the default view stays a
// one-line hint and the reasoning is opt-in.
export default function AiRecoBadge({ reco, pending }) {
  const [expanded, setExpanded] = useState(false);
  if (!reco && !pending) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <p className="muted" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap', margin: 0 }}>
        <strong>AI:</strong>
        {pending ? 'menganalisis...' : (
          <>
            <button
              type="button"
              className={`badge ${ACTION_CLASS[reco.action] || ''}`}
              style={{ border: 'none', fontFamily: 'inherit', cursor: reco.detail ? 'pointer' : 'default' }}
              onClick={() => reco.detail && setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {ACTION_LABEL[reco.action] || reco.action}{reco.detail ? (expanded ? ' ▲' : ' ▾') : ''}
            </button>
            <span>{reco.reason}</span>
          </>
        )}
      </p>
      {expanded && reco?.detail && (
        <p className="muted" style={{ marginTop: 4, lineHeight: 1.45 }}>{reco.detail}</p>
      )}
    </div>
  );
}
