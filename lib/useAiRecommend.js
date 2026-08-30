import { useEffect, useRef, useState } from 'react';

const CACHE_KEY = 'ai_reco_cache';

// Keyed by the signal's own numbers, not just its stock - a signal whose
// entry/SL/TP hasn't changed since last time reuses the cached verdict
// instead of re-asking the AI on every page load, and only a genuinely
// new/changed signal costs a call.
function fingerprint(s) {
  return `${s.stock}|${s.entry}|${s.sl}|${s.tp1}|${s.tp2 ?? ''}`;
}

// Shared by Sinyal and Watchlist so both call the same /api/ai-recommend
// endpoint the same way (one batched request for whatever isn't cached yet,
// localStorage-cached by fingerprint) instead of duplicating this logic.
export function useAiRecommend(signals, token) {
  const [aiReco, setAiReco] = useState({});
  const pendingRef = useRef(new Set());
  const [, forceRerender] = useState(0);

  useEffect(() => {
    try {
      setAiReco(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
    } catch {
      setAiReco({});
    }
  }, []);

  useEffect(() => {
    if (!token || signals.length === 0) return;
    const toFetch = signals.filter((s) => {
      const fp = fingerprint(s);
      return !aiReco[fp] && !pendingRef.current.has(fp);
    });
    if (toFetch.length === 0) return;

    const fps = toFetch.map(fingerprint);
    fps.forEach((fp) => pendingRef.current.add(fp));
    forceRerender((n) => n + 1);

    (async () => {
      try {
        const res = await fetch('/api/ai-recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signals: toFetch.map((s) => ({
              stock: s.stock, tradeType: s.tradeType, entry: s.entry, buyLow: s.buyLow, buyHigh: s.buyHigh,
              sl: s.sl, tp1: s.tp1, tp2: s.tp2, score: s.score,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mendapat rekomendasi AI');
        const byStock = new Map((data.recommendations || []).map((r) => [r.stock.toUpperCase(), r]));
        setAiReco((prev) => {
          const next = { ...prev };
          for (const s of toFetch) {
            const r = byStock.get(s.stock.toUpperCase());
            if (r) next[fingerprint(s)] = { action: r.action, reason: r.reason, detail: r.detail };
          }
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(next));
          } catch {
            // Storage full/unavailable - the recommendation still renders
            // this session, it just won't be cached for next time.
          }
          return next;
        });
      } catch {
        // Silent: AI recommendation is a bonus hint, not core functionality -
        // a failed call just means the badge doesn't show for these signals,
        // it must not block the rest of the page.
      } finally {
        fps.forEach((fp) => pendingRef.current.delete(fp));
        forceRerender((n) => n + 1);
      }
    })();
  }, [signals, token, aiReco]);

  return {
    get: (s) => aiReco[fingerprint(s)],
    isPending: (s) => pendingRef.current.has(fingerprint(s)),
  };
}
