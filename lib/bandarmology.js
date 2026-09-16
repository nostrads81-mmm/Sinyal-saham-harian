// Real bandarmologi needs broker-summary data (which broker net buys/sells
// each stock) and foreign flow - not available for free from IDX, so this
// pulls it from Index Alpha (https://indexalpha.id), a paid third-party API
// that republishes exactly that data. Pure functions here, no network calls,
// so they're easy to test against hand-built broker-summary/foreign-flow
// responses shaped like the real API's JSON.

// `brokerRows` is the `data` array from GET /stocks/broker-summary - one
// entry per broker code active on this ticker over the requested range,
// each already aggregated with its own buy_value/sell_value/etc. Returns
// the top N net buyers and top N net sellers (net = buy_value - sell_value),
// plus `concentration`: the single most dominant broker's net value (signed,
// as a share of total buy value) - whichever side, buy or sell, moved the
// most. A big, concentrated buyer reads as accumulation; a big, concentrated
// seller reads as distribution, and this stays negative for the latter
// instead of only ever measuring the buy side.
export function summarizeBrokerRows(brokerRows, { top = 3 } = {}) {
  const withNet = brokerRows.map((r) => ({ ...r, net: r.buy_value - r.sell_value }));
  const totalBuyValue = brokerRows.reduce((sum, r) => sum + r.buy_value, 0);

  const topBuyers = [...withNet].sort((a, b) => b.net - a.net).slice(0, top);
  const topSellers = [...withNet].sort((a, b) => a.net - b.net).slice(0, top);

  const biggestMover = [topBuyers[0], topSellers[0]]
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0];
  const concentration = totalBuyValue > 0 && biggestMover ? biggestMover.net / totalBuyValue : 0;

  return { topBuyers, topSellers, totalBuyValue, concentration };
}

// `foreignFlow` is the `data` object from GET /foreign-flow for the same
// ticker and date range: { foreign_buy, foreign_sell, net_foreign }.
// Normalizing by total value traded (rather than using the raw rupiah
// figure) makes the signal comparable across stocks of very different
// sizes - "foreign net buy was 3% of everything traded" means the same
// thing whether the stock is BBCA or a small-cap.
export function analyzeBandarmology(brokerRows, foreignFlow) {
  if (!brokerRows || brokerRows.length === 0) return null;

  const { topBuyers, topSellers, totalBuyValue, concentration } = summarizeBrokerRows(brokerRows);
  const foreignRatio = totalBuyValue > 0 ? foreignFlow.net_foreign / totalBuyValue : 0;

  const score = foreignRatio + concentration * 0.5;

  let verdict = 'Netral';
  if (score > 0.15) verdict = 'Akumulasi kuat';
  else if (score > 0.05) verdict = 'Akumulasi';
  else if (score < -0.15) verdict = 'Distribusi kuat';
  else if (score < -0.05) verdict = 'Distribusi';

  return {
    foreignBuy: foreignFlow.foreign_buy,
    foreignSell: foreignFlow.foreign_sell,
    netForeign: foreignFlow.net_foreign,
    foreignRatio,
    concentration,
    topBuyerCode: topBuyers[0]?.code ?? null,
    topSellerCode: topSellers[0]?.code ?? null,
    score,
    verdict,
  };
}
