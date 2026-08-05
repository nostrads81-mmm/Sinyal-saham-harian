import { useEffect, useRef } from 'react';

// Embeds TradingView's free "Single Quote" widget for one IDX symbol - shows
// live last price + change, no API key or backend needed. Each mount injects
// its own <script> per TradingView's embed contract (see
// https://www.tradingview.com/widget/single-quote/); re-injected whenever the
// stock changes since the widget has no imperative update API.
export default function TradingViewQuote({ stock }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: `IDX:${stock}`,
      width: '100%',
      colorTheme: 'dark',
      isTransparent: true,
      locale: 'en',
    });
    containerRef.current.appendChild(script);
  }, [stock]);

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minWidth: 140 }} />;
}
