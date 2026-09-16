import { analyzeBandarmology } from '../../lib/bandarmology';

// Server-side only: Yahoo Finance's chart endpoint doesn't allow CORS from
// a browser, so this proxies it. No API key needed - it's public data.

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

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

async function fetchDailySeries(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.JK?interval=1d&range=3mo`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status} untuk ${ticker}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) throw new Error(`Data kosong untuk ${ticker}`);

  // Yahoo pads non-trading gaps with null entries in each array - drop any
  // day missing a value in any field rather than let a null poison the
  // running OBV/AD totals downstream.
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
  for (let i = 0; i < quote.close.length; i++) {
    if (quote.close[i] == null || quote.high[i] == null || quote.low[i] == null || quote.volume[i] == null) continue;
    closes.push(quote.close[i]);
    highs.push(quote.high[i]);
    lows.push(quote.low[i]);
    volumes.push(quote.volume[i]);
  }
  return { closes, highs, lows, volumes };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const outcomes = await Promise.allSettled(
    TICKERS.map(async (ticker) => {
      const series = await fetchDailySeries(ticker);
      const analysis = analyzeBandarmology(series);
      if (!analysis) throw new Error(`Riwayat harga ${ticker} belum cukup panjang`);
      return { ticker, ...analysis };
    })
  );

  const results = outcomes
    .filter((o) => o.status === 'fulfilled')
    .map((o) => o.value)
    .sort((a, b) => b.score - a.score);

  const failed = outcomes
    .filter((o) => o.status === 'rejected')
    .map((o) => o.reason?.message || 'error tidak diketahui');

  res.status(200).json({ generatedAt: new Date().toISOString(), results, failed });
}
