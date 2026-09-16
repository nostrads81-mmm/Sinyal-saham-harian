const { computeOBV, computeAD, analyzeBandarmology } = require('./bandarmology');

// 25 flat days (price/volume barely moving) followed by a clear volume
// spike on an up day - a textbook "accumulation" shape.
function buildSeries({ days = 25, basePrice = 1000, baseVolume = 100000, spikeVolume, spikeDirection = 'up' } = {}) {
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const isLastFew = spikeVolume != null && i >= days - 5;
    const direction = isLastFew ? (spikeDirection === 'up' ? 1 : -1) : (i % 2 === 0 ? 1 : -1);
    price += direction * (isLastFew ? 15 : 2);
    const high = price + 5;
    const low = price - 5;
    closes.push(price);
    highs.push(high);
    lows.push(low);
    volumes.push(isLastFew ? spikeVolume : baseVolume);
  }
  return { closes, highs, lows, volumes };
}

describe('computeOBV', () => {
  test('adds volume on an up day, subtracts on a down day, holds flat on no change', () => {
    const closes = [100, 105, 102, 102];
    const volumes = [0, 10, 20, 30];
    expect(computeOBV(closes, volumes)).toEqual([0, 10, -10, -10]);
  });
});

describe('computeAD', () => {
  test('weights volume toward the close-to-high side of the day\'s range', () => {
    // Close at the very top of the range -> full volume counted positively.
    const ad = computeAD([110], [90], [110], [50]);
    expect(ad[0]).toBeCloseTo(50);
  });

  test('close at the bottom of the range counts volume negatively', () => {
    const ad = computeAD([110], [90], [90], [50]);
    expect(ad[0]).toBeCloseTo(-50);
  });

  test('a zero-range day (high === low) contributes nothing, no divide-by-zero', () => {
    const ad = computeAD([100], [100], [100], [50]);
    expect(ad[0]).toBe(0);
  });
});

describe('analyzeBandarmology', () => {
  test('returns null when there is not enough history for the volume window', () => {
    const series = buildSeries({ days: 10 });
    expect(analyzeBandarmology(series)).toBeNull();
  });

  test('flags a volume spike on rising closes as accumulation', () => {
    const series = buildSeries({ spikeVolume: 500000, spikeDirection: 'up' });
    const result = analyzeBandarmology(series);
    expect(result.volumeRatio).toBeGreaterThan(1);
    expect(result.obvTrend).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0.3);
    expect(['Akumulasi', 'Akumulasi kuat']).toContain(result.verdict);
  });

  test('flags a volume spike on falling closes as distribution', () => {
    const series = buildSeries({ spikeVolume: 500000, spikeDirection: 'down' });
    const result = analyzeBandarmology(series);
    expect(result.volumeRatio).toBeGreaterThan(1);
    expect(result.obvTrend).toBeLessThan(0);
    expect(result.score).toBeLessThan(-0.3);
    expect(['Distribusi', 'Distribusi kuat']).toContain(result.verdict);
  });

  test('ordinary unchanged volume with no trend reads as neutral', () => {
    const series = buildSeries({ spikeVolume: undefined });
    const result = analyzeBandarmology(series);
    expect(result.verdict).toBe('Netral');
  });
});
