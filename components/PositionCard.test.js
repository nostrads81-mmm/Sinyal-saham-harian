import { renderToStaticMarkup } from 'react-dom/server';
import PositionCard from './PositionCard';

// Same reasoning as components/SignalCard.test.js: the Rekapan card is the
// other place a trade gets read, so it gets a server-render smoke test rather
// than relying on someone remembering to click through both tabs. Interaction
// (tap to expand, forms) is still checked by hand in the browser.
const BADGE = { cls: 'badge', label: 'running' };

function card(overrides = {}) {
  const entry = {
    rowNumber: 7,
    stock: 'TLKM',
    tag: 'koko_saham',
    entry: 3000,
    sl: 2900,
    tp1: 3200,
    tp2: 3400,
    status: 'RUNNING',
    tanggalEntry: '18-09-2026',
    catatan: 'Lot: 5',
    tradeType: 'DAY TRADE',
    ...overrides.entry,
  };
  const ui = {
    expanded: false,
    confirming: false,
    closing: false,
    menuOpen: false,
    tvOpen: false,
    cancelling: false,
    saving: false,
    confirmPrice: '',
    confirmLot: '',
    exitPrice: '',
    ...overrides.ui,
  };
  return renderToStaticMarkup(
    <PositionCard
      entry={entry}
      settings={{ capital: 50_000_000, tpMode: 'mid', ...overrides.settings }}
      badge={overrides.badge || BADGE}
      lot={overrides.lot ?? 5}
      ui={ui}
      actions={{}}
    />
  );
}

describe('PositionCard', () => {
  test('renders the position with its three prices and lot count', () => {
    const html = card();

    expect(html).toContain('TLKM');
    expect(html).toContain('3.000'); // entry
    expect(html).toContain('2.900'); // SL
    expect(html).toContain('3.300'); // TP tengah dari 3200 & 3400
    expect(html).toContain('5 lot');
    expect(html).toContain('running');
  });

  test('a RUNNING position offers Tutup posisi, not Konfirmasi fill', () => {
    const html = card();

    expect(html).toContain('Tutup posisi');
    expect(html).not.toContain('Konfirmasi fill');
  });

  test('a PENDING position offers Konfirmasi fill and no way to close it yet', () => {
    const html = card({ entry: { status: 'PENDING' } });

    expect(html).toContain('Konfirmasi fill');
    expect(html).not.toContain('Tutup posisi');
  });

  test('collapsed by default: dates and TP details stay hidden', () => {
    const html = card();

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Dibeli 18-09-2026');
    expect(html).not.toContain('TP1');
  });

  test('expanded shows the entry date and both targets in combined TP mode', () => {
    const html = card({ ui: { expanded: true } });

    expect(html).toContain('Dibeli 18-09-2026');
    expect(html).toContain('TP1');
    expect(html).toContain('TP2');
  });

  // The delete action lives behind the ⋯ menu, so it must not appear when the
  // menu is closed - and must not be reachable for a position that is already
  // filled (there "Batalkan order" would silently delete a real trade).
  test('Batalkan order only exists inside the menu, and only for a pending order', () => {
    expect(card()).not.toContain('Batalkan order');
    expect(card({ ui: { menuOpen: true } })).not.toContain('Batalkan order');
    expect(card({ entry: { status: 'PENDING' }, ui: { menuOpen: true } })).toContain('Batalkan order');
  });

  test('the close form asks for an exit price and blocks an empty one', () => {
    const html = card({ ui: { closing: true } });

    expect(html).toContain('Harga exit');
    expect(html).toContain('disabled');
    expect(html).toContain('Simpan');
  });

  test('the confirm-fill form asks for the actual price and lot', () => {
    const html = card({ entry: { status: 'PENDING' }, ui: { confirming: true, confirmPrice: '3010', confirmLot: '5' } });

    expect(html).toContain('Harga fill aktual');
    expect(html).toContain('Jumlah (lot)');
    expect(html).toContain('Sudah ke-fill');
  });
});
