import { renderToStaticMarkup } from 'react-dom/server';
import SignalCard from './SignalCard';

// The card is the densest piece of JSX in the app - it replaced a 259-line
// renderer that was inlined in pages/index.js. There is no component-test setup
// here (no React Testing Library), so this is deliberately a server-render
// smoke test: it proves every branch renders without throwing and that the
// numbers the user decides on actually make it into the markup. Interaction
// (tap to expand, forms) is still verified by hand in the browser.
function render(overrides = {}) {
  const signal = {
    stock: 'BBCA',
    tradeType: 'DAY TRADE',
    entry: 9000,
    sl: 8800,
    tp1: 9300,
    tp2: 9500,
    tpMid: 9400,
    tp3: null,
    mmPercent: 10,
    score: 1.3,
    ageDays: 0,
    source: 'wa',
    isOpen: true,
    willSkip: false,
    skipReason: null,
    status: 'OPEN',
    detailStatus: '',
    tag: 'koko_saham',
    buyLow: 8950,
    buyHigh: 9050,
    capturedAt: '2024-01-01T00:00:00.000Z',
    position: { rupiah: 1_800_000, lembar: 200 },
    adjusted: false,
    capReason: 'risiko',
    ...overrides.signal,
  };
  return renderToStaticMarkup(
    <SignalCard
      signal={signal}
      settings={{ capital: 50_000_000, tpMode: 'mid', ...overrides.settings }}
      spotlight={overrides.spotlight || false}
      tvOpen={overrides.tvOpen || false}
      onCopy={() => {}}
      onToggleTv={() => {}}
      onToggleSkip={() => {}}
      onRemove={() => {}}
      onSaveRecord={async () => {}}
      onSaveEntry={async () => {}}
    />
  );
}

describe('SignalCard', () => {
  test('renders the ticker, the score and the three decision prices', () => {
    const html = render();

    expect(html).toContain('BBCA');
    expect(html).toContain('9.000'); // entry
    expect(html).toContain('8.800'); // SL
    expect(html).toContain('9.400'); // TP tengah
    expect(html).toContain('skor');
  });

  test('shows the suggested size in short form, not the full rupiah digits', () => {
    const html = render();

    expect(html).toContain('Rp1,8 jt');
    expect(html).not.toContain('Rp1.800.000');
    expect(html).toContain('2 lot');
    expect(html).toContain('MM 10%');
  });

  test('a skipped signal keeps its reason visible', () => {
    const html = render({ signal: { willSkip: true, skipReason: 'batas-mm' } });

    expect(html).toContain('skip · MM kecil');
    expect(html).toContain('skip-card');
  });

  test('separate TP mode labels the first target TP1', () => {
    const html = render({ settings: { tpMode: 'separate' } });

    expect(html).toContain('TP1');
    expect(html).toContain('9.300');
    expect(html).not.toContain('9.400');
  });

  test('collapsed by default: the range bar and the detail copy stay hidden', () => {
    const html = render();

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Saran posisi');
    expect(html).not.toContain('Terbit hari ini');
  });

  test('no tag means no badge', () => {
    const html = render({ signal: { tag: null } });

    expect(html).not.toContain('koko_saham');
    expect(html).toContain('BBCA');
  });

  test('renders a journaled signal without crashing on a null position', () => {
    const html = render({
      signal: { isOpen: false, position: null, status: 'RUNNING', ageDays: 3 },
    });

    expect(html).toContain('BBCA');
    expect(html).not.toContain('Beli');
    expect(html).not.toContain('Catat order');
  });
});
