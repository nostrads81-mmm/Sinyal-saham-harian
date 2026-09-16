import { analyzeBandarmology } from '../../lib/bandarmology';

// Server-side only: INDEXALPHA_API_KEY never reaches the browser bundle.
// Index Alpha (https://indexalpha.id) republishes IDX broker-summary and
// foreign-flow data - the actual "who's buying/selling" numbers real
// bandarmologi needs, which IDX itself doesn't publish for free.

const BASE = 'https://api.indexalpha.id';

// Approximate LQ45/IDX30 overlap (large, liquid IDX names) as a static list -
// there's no free API for "give me the current LQ45 constituents", and the
// index itself is reconstituted twice a year, so this occasionally drifts
// from the official list. Update by hand from idx.co.id if it gets stale.
const TICKERS = [
  'AALI', 'ACES', 'ADMR', 'ADRO', 'AKRA', 'AMMN', 'AMRT', 'ANTM', 'ARTO', 'ASII',
  'BBCA', 'BBNI', 'BBRI', 'BBTN', 'BFIN', 'BMRI', 'BRIS', 'BRPT', 'BUKA', 'CPIN',
  'CTRA', 'ESSA', 'EXCL', 'GGRM', 'GOTO', 'HRUM', 'ICBP', 'INCO', 'INDF', 'INKP',
  'INTP', 'ISAT', 'ITMG', 'JPFA', 'JSMR', 'KLBF', 'MAPI', 'MBMA', 'MDKA', 'MEDC',
  'PGAS', 'PGEO', 'PTBA', 'SIDO', 'SMGR', 'SMRA', 'SRTG', 'TLKM', 'TOWR', 'UNTR',
  'UNVR', 'MTEL',
];

// A few trading days of aggregate flow, not just today - single-day broker
// summary can be noisy (one big block trade skews it), so this smooths over
// the last week instead.
const RANGE_DAYS = 5;

function dateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - RANGE_DAYS);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function indexAlphaFetch(path, apiKey) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Index Alpha error ${res.status}`);
  }
  return body.data;
}

async function fetchTickerFlow(ticker, apiKey, from, to) {
  const [brokerRows, foreignFlow] = await Promise.all([
    indexAlphaFetch(`/stocks/broker-summary?ticker=${ticker}&from=${from}&to=${to}&investor=all`, apiKey),
    indexAlphaFetch(`/foreign-flow?ticker=${ticker}&from=${from}&to=${to}`, apiKey),
  ]);
  const analysis = analyzeBandarmology(brokerRows, foreignFlow);
  if (!analysis) throw new Error(`Data broker summary ${ticker} kosong`);
  return { ticker, ...analysis };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.INDEXALPHA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'INDEXALPHA_API_KEY belum diset di server' });
    return;
  }

  const { from, to } = dateRange();
  const outcomes = await Promise.allSettled(
    TICKERS.map((ticker) => fetchTickerFlow(ticker, apiKey, from, to))
  );

  const results = outcomes
    .filter((o) => o.status === 'fulfilled')
    .map((o) => o.value)
    .sort((a, b) => b.score - a.score);

  const failed = outcomes
    .filter((o) => o.status === 'rejected')
    .map((o) => o.reason?.message || 'error tidak diketahui');

  res.status(200).json({ generatedAt: new Date().toISOString(), range: { from, to }, results, failed });
}
