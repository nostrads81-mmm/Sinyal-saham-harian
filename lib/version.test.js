const { extractBuildId, isUpdateAvailable, getCurrentBuildId } = require('./version');

function installWindowWithBuildId(buildId) {
  global.window = { __NEXT_DATA__: buildId != null ? { buildId } : undefined };
}

describe('extractBuildId', () => {
  test('pulls the buildId out of a __NEXT_DATA__ script blob', () => {
    const html = '<html><script id="__NEXT_DATA__">{"props":{},"page":"/","buildId":"abc123","query":{}}</script></html>';
    expect(extractBuildId(html)).toBe('abc123');
  });

  test('returns null when there is no buildId to find', () => {
    expect(extractBuildId('<html>not next.js output</html>')).toBeNull();
    expect(extractBuildId('')).toBeNull();
    expect(extractBuildId(undefined)).toBeNull();
  });
});

describe('getCurrentBuildId', () => {
  afterEach(() => { delete global.window; });

  test('reads it off window.__NEXT_DATA__', () => {
    installWindowWithBuildId('current-build');
    expect(getCurrentBuildId()).toBe('current-build');
  });

  test('returns null when window is unavailable (SSR) or has no build data', () => {
    delete global.window;
    expect(getCurrentBuildId()).toBeNull();
    installWindowWithBuildId(null);
    expect(getCurrentBuildId()).toBeNull();
  });
});

describe('isUpdateAvailable', () => {
  afterEach(() => {
    delete global.window;
    delete global.fetch;
  });

  test('true when the freshly-fetched page reports a different buildId', async () => {
    installWindowWithBuildId('old-build');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<script id="__NEXT_DATA__">{"buildId":"new-build"}</script>'),
    }));

    await expect(isUpdateAvailable()).resolves.toBe(true);
  });

  test('false when the buildId is unchanged', async () => {
    installWindowWithBuildId('same-build');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<script id="__NEXT_DATA__">{"buildId":"same-build"}</script>'),
    }));

    await expect(isUpdateAvailable()).resolves.toBe(false);
  });

  test('false (not "unknown treated as update") when this tab has no buildId of its own', async () => {
    installWindowWithBuildId(null);
    global.fetch = jest.fn();

    await expect(isUpdateAvailable()).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('false when the fetch fails or the response has no buildId', async () => {
    installWindowWithBuildId('old-build');
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    await expect(isUpdateAvailable()).resolves.toBe(false);

    global.fetch = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('<html></html>') }));
    await expect(isUpdateAvailable()).resolves.toBe(false);
  });
});
