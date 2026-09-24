import { renderToStaticMarkup } from 'react-dom/server';
import UpdateFab from './UpdateFab';

// Server-render smoke test only - the polling/idle-detection logic lives in
// a useEffect, which SSR never runs, so this just proves the button itself
// renders in its default (no update yet) state without throwing.
describe('UpdateFab', () => {
  test('renders a plain refresh button with no "update available" styling by default', () => {
    const html = renderToStaticMarkup(<UpdateFab />);

    expect(html).toContain('update-fab');
    expect(html).not.toContain('has-update');
    expect(html).toContain('Muat ulang halaman');
  });
});
