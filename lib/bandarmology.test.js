const { summarizeBrokerRows, analyzeBandarmology } = require('./bandarmology');

// Shaped like one row of Index Alpha's GET /stocks/broker-summary `data`
// array: { code, buy_freq, buy_volume, buy_value, sell_freq, sell_volume,
// sell_value, buy_avg, sell_avg }.
function brokerRow(code, { buyValue = 0, sellValue = 0 } = {}) {
  return {
    code,
    buy_freq: 1, buy_volume: 1, buy_value: buyValue, buy_avg: 0,
    sell_freq: 1, sell_volume: 1, sell_value: sellValue, sell_avg: 0,
  };
}

describe('summarizeBrokerRows', () => {
  test('ranks brokers by net (buy_value - sell_value), buyers descending and sellers ascending', () => {
    const rows = [
      brokerRow('AA', { buyValue: 100, sellValue: 10 }), // net +90
      brokerRow('BB', { buyValue: 10, sellValue: 80 }),  // net -70
      brokerRow('CC', { buyValue: 50, sellValue: 50 }),  // net 0
    ];
    const { topBuyers, topSellers } = summarizeBrokerRows(rows, { top: 2 });
    expect(topBuyers.map((r) => r.code)).toEqual(['AA', 'CC']);
    expect(topSellers.map((r) => r.code)).toEqual(['BB', 'CC']);
  });

  test('concentration is the single most dominant broker\'s net value over total buy value', () => {
    const rows = [
      brokerRow('AA', { buyValue: 80, sellValue: 0 }),
      brokerRow('BB', { buyValue: 20, sellValue: 0 }),
    ];
    const { concentration } = summarizeBrokerRows(rows);
    // total buy value = 100, biggest mover (AA, a net buyer) net = 80 -> +0.8
    expect(concentration).toBeCloseTo(0.8);
  });

  test('concentration is negative when the most dominant broker is a net seller', () => {
    const rows = [
      brokerRow('AA', { buyValue: 50000, sellValue: 950000 }), // net -900000, larger magnitude
      brokerRow('BB', { buyValue: 400000, sellValue: 50000 }), // net +350000
    ];
    const { concentration } = summarizeBrokerRows(rows);
    // total buy value = 450000, dominant mover (AA, a net seller) net = -900000
    expect(concentration).toBeCloseTo(-2, 1);
  });
});

describe('analyzeBandarmology', () => {
  test('returns null with no broker rows', () => {
    expect(analyzeBandarmology([], { foreign_buy: 0, foreign_sell: 0, net_foreign: 0 })).toBeNull();
  });

  test('strong net foreign buying plus a concentrated single buyer reads as accumulation', () => {
    const rows = [
      brokerRow('YP', { buyValue: 900000, sellValue: 50000 }),
      brokerRow('ZZ', { buyValue: 100000, sellValue: 950000 }),
    ];
    const foreignFlow = { foreign_buy: 500000, foreign_sell: 100000, net_foreign: 400000 };
    const result = analyzeBandarmology(rows, foreignFlow);
    expect(result.netForeign).toBe(400000);
    expect(result.topBuyerCode).toBe('YP');
    expect(result.topSellerCode).toBe('ZZ');
    expect(['Akumulasi', 'Akumulasi kuat']).toContain(result.verdict);
  });

  test('strong net foreign selling plus a dominant net seller reads as distribution', () => {
    const rows = [
      brokerRow('YP', { buyValue: 50000, sellValue: 950000 }), // net -900000, the dominant mover
      brokerRow('ZZ', { buyValue: 400000, sellValue: 50000 }), // net +350000
    ];
    const foreignFlow = { foreign_buy: 100000, foreign_sell: 500000, net_foreign: -400000 };
    const result = analyzeBandarmology(rows, foreignFlow);
    expect(result.concentration).toBeLessThan(0);
    expect(['Distribusi', 'Distribusi kuat']).toContain(result.verdict);
  });

  test('balanced flow with no concentration reads as neutral', () => {
    const rows = [
      brokerRow('AA', { buyValue: 500000, sellValue: 500000 }),
      brokerRow('BB', { buyValue: 500000, sellValue: 500000 }),
    ];
    const foreignFlow = { foreign_buy: 10000, foreign_sell: 10000, net_foreign: 0 };
    const result = analyzeBandarmology(rows, foreignFlow);
    expect(result.verdict).toBe('Netral');
  });
});
