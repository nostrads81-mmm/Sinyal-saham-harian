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
      <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="9" fill="#131722" />
        <rect x="7" y="14" width="4.5" height="10" fill="#fff" />
        <path
          d="M14 19.5L18 24l7.5-13.5"
          stroke="#fff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}
