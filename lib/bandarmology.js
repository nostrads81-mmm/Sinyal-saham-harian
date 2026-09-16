// "Bandarmologi" proper needs broker-summary data (which broker net buys/
// sells each stock) - that isn't available for free from IDX. This is a
// volume-based proxy for the same underlying idea (follow where the big
// money is moving) using only free daily price/volume data: an unusual
// volume spike combined with OBV/Accumulation-Distribution trending the
// same direction reads as accumulation (or distribution); pure functions,
// no network calls, so they're easy to test against hand-built OHLCV series.

// Cumulative running total that adds the day's volume when price closes up
// and subtracts it when price closes down - a classic proxy for whether
// volume is flowing in on up days (accumulation) or down days (distribution).
export function computeOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    const prevObv = obv[i - 1];
    if (closes[i] > closes[i - 1]) obv.push(prevObv + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(prevObv - volumes[i]);
    else obv.push(prevObv);
  }
  return obv;
}

// Accumulation/Distribution Line: weights each day's volume by where the
// close landed within that day's range (close near the high = accumulation-
// weighted, close near the low = distribution-weighted), then accumulates.
export function computeAD(highs, lows, closes, volumes) {
  const ad = [];
  let cumulative = 0;
  for (let i = 0; i < closes.length; i++) {
    const range = highs[i] - lows[i];
    const moneyFlowMultiplier = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    cumulative += moneyFlowMultiplier * volumes[i];
    ad.push(cumulative);
  }
  return ad;
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// How far a cumulative series (OBV/AD) moved over the last `window` days,
// expressed in units of "average daily volume" - makes the trend comparable
// across stocks of very different sizes instead of a raw, unitless number.
function normalizedTrend(series, window, avgVolume) {
  if (series.length < window + 1 || avgVolume <= 0) return 0;
  const delta = series[series.length - 1] - series[series.length - 1 - window];
  return delta / (avgVolume * window);
}

// `series` is one stock's recent daily OHLCV, oldest first: parallel arrays
// closes/highs/lows/volumes of equal length. Returns null when there isn't
// enough history yet for a stable 20-day average volume.
export function analyzeBandarmology(series, { volumeWindow = 20, trendWindow = 5 } = {}) {
  const { closes, highs, lows, volumes } = series;
  if (!closes || closes.length < volumeWindow + 1) return null;

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const changePercent = prevClose ? ((lastClose - prevClose) / prevClose) * 100 : 0;

  const avgVolume = average(volumes.slice(-volumeWindow - 1, -1));
  const lastVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 0;

  const obv = computeOBV(closes, volumes);
  const ad = computeAD(highs, lows, closes, volumes);
  const obvTrend = normalizedTrend(obv, trendWindow, avgVolume);
  const adTrend = normalizedTrend(ad, trendWindow, avgVolume);

  // Volume spike (ratio above 1) plus both cumulative lines trending the
  // same way reinforces the read; a spike with no trend agreement nets out
  // closer to neutral rather than swinging the score on volume alone.
  const score = (volumeRatio - 1) + obvTrend + adTrend;

  let verdict = 'Netral';
  if (score > 1) verdict = 'Akumulasi kuat';
  else if (score > 0.3) verdict = 'Akumulasi';
  else if (score < -1) verdict = 'Distribusi kuat';
  else if (score < -0.3) verdict = 'Distribusi';

  return { lastClose, changePercent, volumeRatio, obvTrend, adTrend, score, verdict };
}
