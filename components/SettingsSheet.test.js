import { renderToStaticMarkup } from 'react-dom/server';
import SettingsSheet from './SettingsSheet';

// The settings panel is all UI, so a render test is the honest check: does it
// still produce the three sections (and the sticky actions) after the bottom
// sheet rework, and does it stay silent when closed.
function render(overrides = {}) {
  return renderToStaticMarkup(
    <SettingsSheet
      open
      onClose={() => {}}
      capital={350_000_000}
      riskPercent={0.005}
      maxSlots={10}
      buyFeePercent={0.0015}
      sellFeePercent={0.0025}
      materaiAmount={10000}
      materaiThreshold={10000000}
      entryMode="mid"
      tpMode="mid"
      onSave={() => {}}
      saving={false}
      {...overrides}
    />
  );
}

describe('SettingsSheet', () => {
  test('renders the three sections and the actions', () => {
    const html = render();

    expect(html).toContain('Modal &amp; Risiko');
    expect(html).toContain('Biaya &amp; Materai');
    expect(html).toContain('Tampilan');
    expect(html).toContain('Modal Awal');
    expect(html).toContain('Fee beli (%)');
    expect(html).toContain('Batas kena materai (Rp)');
    expect(html).toContain('Simpan');
    expect(html).toContain('Batal');
  });

  test('shows Tambah/Kurang Modal only when a handler is provided', () => {
    expect(render()).not.toContain('Tambah/Kurang Modal');

    const html = render({ onSubmitModalTransaction: () => {} });
    expect(html).toContain('Tambah/Kurang Modal');
    expect(html).toContain('Tarik modal');
    expect(html).toContain('Tambah modal');
  });

  test('pre-fills fee fields in percent form, not as fractions', () => {
    const html = render();

    expect(html).toContain('value="0.15"');
    expect(html).toContain('value="0.25"');
  });

  test('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <SettingsSheet open={false} onClose={() => {}} />
    );

    expect(html).toBeFalsy();
  });
});