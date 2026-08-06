// Icon-only toggle for the TradingView quote widget - just the TradingView
// mark, no label, so it doesn't compete for space with the ticker/score/
// action buttons on an already-dense card.
export default function TradingViewButton({ onClick, active }) {
  return (
    <button
      type="button"
      className="btn icon-btn"
      onClick={onClick}
      aria-label="TradingView"
      aria-pressed={active}
      style={{ padding: '4px 8px', lineHeight: 0 }}
    >
      <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="7" fill="#131722" />
        <path d="M8 20.5V9h3.4v8.3H16v3.2H8z" fill="#2962FF" />
        <circle cx="21.2" cy="12.4" r="3.4" fill="#2962FF" />
        <path d="M8 23h16v1.8H8z" fill="#787B86" />
      </svg>
    </button>
  );
}
